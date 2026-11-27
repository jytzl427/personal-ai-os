import ctypes
import errno
import json
import os
import resource
import socket
import sys

MAX_MESSAGE_BYTES = 2 * 1024 * 1024
MAX_MODEL_CALLS = 5
MAX_TOOL_CALLS = 4


def send(message):
    sys.stdout.write(json.dumps(message, ensure_ascii=True, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def receive(expected):
    line = sys.stdin.buffer.readline(MAX_MESSAGE_BYTES + 1)
    if not line or len(line) > MAX_MESSAGE_BYTES:
        raise ValueError("invalid input size")
    message = json.loads(line)
    if message["type"] != expected:
        raise ValueError("unexpected broker message")
    return message


def inspect_boundaries(files):
    reads_denied = []
    for filename in files:
        try:
            descriptor = os.open(filename, os.O_RDONLY)
        except OSError as error:
            reads_denied.append(error.errno in (errno.EACCES, errno.EPERM))
        else:
            os.close(descriptor)
            reads_denied.append(False)
    try:
        ordinary_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    except OSError as error:
        network_denied = error.errno in (errno.EACCES, errno.EPERM)
    else:
        ordinary_socket.close()
        network_denied = False
    send({"type": "inspection", "reads_denied": reads_denied, "network_denied": network_denied})


def assistant_loop(prompt):
    messages = [
        {
            "role": "system",
            "content": (
                "你是本机待办助手。使用已授权的工具。仅在用户明确要求写入时才调用写入工具。"
                "工具返回需要本人确认时，把它当作待确认操作。请用中文简洁回答。"
            ),
        },
        {"role": "user", "content": prompt},
    ]
    tool_budget = MAX_TOOL_CALLS
    for model_index in range(MAX_MODEL_CALLS):
        send({"type": "model", "messages": messages, "allow_tools": tool_budget > 0 and model_index < MAX_MODEL_CALLS - 1})
        reply = receive("model_reply")["reply"]
        calls = reply["calls"]
        if not calls:
            send({"type": "complete", "text": reply["text"]})
            return
        if len(calls) > tool_budget or model_index == MAX_MODEL_CALLS - 1:
            break
        tool_budget -= len(calls)
        messages.append({
            "role": "assistant", "content": reply["text"] or None,
            "tool_calls": [
                {"id": call["id"], "type": "function", "function": {"name": call["name"], "arguments": call["arguments"]}}
                for call in calls
            ],
        })
        for call in calls:
            send({"type": "tool", "name": call["name"]})
            result = receive("tool_reply")["result"]
            messages.append({
                "role": "tool", "tool_call_id": call["id"],
                "content": json.dumps(result, ensure_ascii=False, separators=(",", ":")),
            })
    send({"type": "complete", "text": "本轮已达到可调用次数，请确认现有请求或开启新一轮。"})


def main():
    protector = ctypes.CDLL(sys.argv[1], use_errno=True)
    protector.paios_restrict_worker.argtypes = []
    protector.paios_restrict_worker.restype = ctypes.c_int
    os.closerange(3, 65536)
    resource.setrlimit(resource.RLIMIT_AS, (128 * 1024 * 1024, 128 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    abi = protector.paios_restrict_worker()
    if abi < 0:
        raise OSError(ctypes.get_errno(), "cannot install the worker sandbox")
    send({"type": "ready", "landlock_abi": abi, "pid": os.getpid()})
    start = receive("start")
    if sys.argv[2:] == ["--inspect"]:
        inspect_boundaries(start["files"])
    else:
        assistant_loop(start["prompt"])


if __name__ == "__main__":
    try:
        main()
    except OSError as error:
        sys.stderr.write(f"AI worker stopped (OS error {error.errno})\n")
        sys.exit(1)
    except Exception:
        sys.exit(1)
