#define _GNU_SOURCE
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <signal.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/mman.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <unistd.h>

#if defined(__x86_64__)
#define PAIOS_AUDIT_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define PAIOS_AUDIT_ARCH AUDIT_ARCH_AARCH64
#else
#error "The AI sandbox requires a supported Linux architecture."
#endif

#define ALLOW_SYSCALL(number) \
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (number), 0, 1), \
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW)

#define DENY BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM)

static int install_syscall_filter(void) {
    /* The worker only parses JSON over inherited standard streams. */
    const struct sock_filter filters[] = {
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, PAIOS_AUDIT_ARCH, 1, 0),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_read, 0, 4),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, STDIN_FILENO, 1, 0),
        DENY,
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_write, 0, 5),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, STDOUT_FILENO, 2, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, STDERR_FILENO, 1, 0),
        DENY,
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_mmap, 1, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_mprotect, 0, 4),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
        BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, PROT_EXEC, 0, 1),
        DENY,
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
        ALLOW_SYSCALL(SYS_close),
        ALLOW_SYSCALL(SYS_brk),
        ALLOW_SYSCALL(SYS_munmap),
        ALLOW_SYSCALL(SYS_mremap),
        ALLOW_SYSCALL(SYS_madvise),
        ALLOW_SYSCALL(SYS_futex),
        ALLOW_SYSCALL(SYS_clock_gettime),
        ALLOW_SYSCALL(SYS_getpid),
        ALLOW_SYSCALL(SYS_rt_sigaction),
        ALLOW_SYSCALL(SYS_rt_sigprocmask),
        ALLOW_SYSCALL(SYS_rt_sigreturn),
        ALLOW_SYSCALL(SYS_exit),
        ALLOW_SYSCALL(SYS_exit_group),
        DENY,
    };
    const struct sock_fprog program = {
        .len = (unsigned short)(sizeof(filters) / sizeof(filters[0])),
        .filter = (struct sock_filter *)filters,
    };
    long result = syscall(SYS_seccomp, SECCOMP_SET_MODE_FILTER, SECCOMP_FILTER_FLAG_TSYNC, &program);
    if (result > 0) errno = EBUSY;
    return result == 0 ? 0 : -1;
}

static int restrict_filesystem(void) {
    int abi = (int)syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
    // The syscall filter also denies filesystem access on kernels without Landlock.
    if (abi < 3) return 0;
    struct landlock_ruleset_attr access = {
        .handled_access_fs = LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE |
            LANDLOCK_ACCESS_FS_READ_DIR | LANDLOCK_ACCESS_FS_WRITE_FILE |
            LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_REMOVE_FILE |
            LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_DIR |
            LANDLOCK_ACCESS_FS_MAKE_REG | LANDLOCK_ACCESS_FS_MAKE_SOCK |
            LANDLOCK_ACCESS_FS_MAKE_FIFO | LANDLOCK_ACCESS_FS_MAKE_BLOCK |
            LANDLOCK_ACCESS_FS_MAKE_SYM | LANDLOCK_ACCESS_FS_REFER |
            LANDLOCK_ACCESS_FS_TRUNCATE,
    };

    /* Accept no paths. Only this single-threaded worker and its pipes remain. */
    int ruleset = (int)syscall(SYS_landlock_create_ruleset, &access, sizeof(access), 0);
    if (ruleset < 0) return -1;
    long restricted = syscall(SYS_landlock_restrict_self, ruleset, 0);
    int saved_errno = errno;
    close(ruleset);
    if (restricted != 0) {
        errno = saved_errno;
        return -1;
    }
    return abi;
}

int paios_restrict_worker(void) {
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0 ||
        prctl(PR_SET_PDEATHSIG, SIGKILL, 0, 0, 0) != 0 ||
        prctl(PR_SET_DUMPABLE, 0, 0, 0, 0) != 0) return -1;
    int landlock = restrict_filesystem();
    if (landlock < 0) return -1;
    const struct rlimit descriptor_limit = { 3, 3 };
    if (setrlimit(RLIMIT_NOFILE, &descriptor_limit) != 0 || install_syscall_filter() != 0) return -1;
    return landlock;
}
