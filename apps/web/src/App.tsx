import { AppShell } from "./components/AppShell.js";
import { AccountGate, AccountSettings, type LocalAccount } from "./components/AccountControls.js";
import { useHashRoute } from "./hooks/useHashRoute.js";
import { ArchivePage } from "./pages/ArchivePage.js";
import { AiPage } from "./pages/AiPage.js";
import { FinancePage } from "./pages/FinancePage.js";
import { HealthPage } from "./pages/HealthPage.js";
import { ProjectDetailPage, ProjectsPage } from "./pages/ProjectsPage.js";
import { ReviewDetailPage, ReviewsPage } from "./pages/ReviewsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { PlansReviewsPage } from "./pages/PlansReviewsPage.js";
import { ThinkingPage } from "./pages/ThinkingPage.js";
import { TasksPage } from "./pages/TasksPage.js";
import { TaskDetailPage } from "./pages/TaskDetailPage.js";
import { RecurringTaskTemplatePage } from "./pages/RecurringTaskTemplatePage.js";
import { TodayPage } from "./pages/TodayPage.js";
import type { Route } from "./lib/route.js";

export default function App() {
  const { route, navigate } = useHashRoute();

  return <AccountGate>{(account, signOut) => (
    <AppShell key={account.id} route={route} onNavigate={navigate}>
      <Page route={route} onNavigate={navigate} account={account} signOut={signOut} />
    </AppShell>
  )}</AccountGate>;
}

function Page({ route, onNavigate, account, signOut }: {
  route: Route; onNavigate: (route: Route) => void; account: LocalAccount; signOut: () => Promise<void>;
}) {
  switch (route.name) {
    case "today":
      return <TodayPage onNavigate={onNavigate} />;
    case "tasks":
      return <TasksPage initialTab={route.tab} onNavigate={onNavigate} />;
    case "task":
      return <TaskDetailPage id={route.id} onNavigate={onNavigate} />;
    case "recurring-task":
      return <RecurringTaskTemplatePage id={route.id} onNavigate={onNavigate} />;
    case "projects":
      return <ProjectsPage onNavigate={onNavigate} />;
    case "project":
      return <ProjectDetailPage id={route.id} onNavigate={onNavigate} />;
    case "finance":
      return <FinancePage tab={route.tab} onNavigate={onNavigate} />;
    case "health":
      return <HealthPage />;
    case "plans":
      return <PlansReviewsPage tab={route.tab} onNavigate={onNavigate} />;
    case "thinking":
      return <ThinkingPage onNavigate={onNavigate} />;
    case "reviews":
      return <ReviewsPage tab={route.tab} onNavigate={onNavigate} />;
    case "review":
      return <ReviewDetailPage id={route.id} tab={route.tab} onNavigate={onNavigate} />;
    case "butler":
      return <AiPage />;
    case "archive":
      return <ArchivePage tab={route.tab} onNavigate={onNavigate} />;
    case "settings":
      return <SettingsPage accountControls={<AccountSettings account={account} signOut={signOut} />} />;
  }
}
