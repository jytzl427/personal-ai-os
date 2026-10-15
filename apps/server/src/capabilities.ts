import { hasScope, type AgentAuth } from "./auth.js";

type CapabilityDomain = "tasks" | "projects" | "ideas" | "finance" | "health" | "reviews";

const DOMAIN_LABELS: Record<CapabilityDomain, string> = {
  tasks: "任务与周期任务",
  projects: "项目与项目计划",
  ideas: "想法",
  finance: "财务记录与账户流水",
  health: "健康记录",
  reviews: "复盘"
};

function allowed(auth: AgentAuth | null, domain: CapabilityDomain, permission: "read" | "write"): boolean {
  return !auth || hasScope(auth, `${domain}:${permission}`);
}

export function buildCapabilities(auth: AgentAuth | null) {
  const readable = (Object.keys(DOMAIN_LABELS) as CapabilityDomain[])
    .filter((domain) => allowed(auth, domain, "read"))
    .map((domain) => DOMAIN_LABELS[domain]);
  const writable = (Object.keys(DOMAIN_LABELS) as CapabilityDomain[])
    .filter((domain) => allowed(auth, domain, "write"))
    .map((domain) => DOMAIN_LABELS[domain]);
  const answer = [
    "我可以读取 Personal AI OS 本地数据库中的任务、周期任务、项目、想法、财务、健康和复盘数据。",
    "我可以根据真实数据制定阶段计划和每日计划草案、按执行情况调整、推进项目并生成复盘草稿。任务日期就是执行日期。",
    writable.length > 0 ? `当前接入权限允许修改：${writable.join("、")}。` : "当前接入权限为只读，不能修改业务数据。",
    "我不能物理删除数据、清空数据库、恢复备份、修改数据库结构或批准高风险操作；这些操作必须由你在图形界面确认。"
  ].join("\n");
  return {
    ok: true,
    answer,
    capabilities: {
      readable,
      writable,
      scheduling: readable.includes(DOMAIN_LABELS.tasks),
      review_assistance: readable.includes(DOMAIN_LABELS.reviews),
      project_planning: readable.includes(DOMAIN_LABELS.projects)
    },
    restrictions: [
      "数据库是唯一事实来源，不得凭空补全数据",
      "删除、清空、恢复备份、权限管理和 schema 变更不开放给 Agent",
      "周期任务由系统计算，Agent 不得自行推算或重复生成",
      "未确认覆盖当天的阶段计划时，不能推进项目（关联项目任务、更新项目状态或工作区）",
      "复盘和今日任务统计只按 due_date，不把 scheduled_date 当成执行日期"
    ],
    source: "capabilities_get"
  };
}

export function isCapabilitiesQuestion(value: string): boolean {
  return /你能做什么|你可以做什么|有哪些能力|能帮我做什么|功能介绍|能力介绍/.test(value.trim());
}
