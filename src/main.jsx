import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import "@fontsource-variable/nunito";
import "@fontsource-variable/bricolage-grotesque";
import "./styles.css";
import { Auth, ForgotPassword, ResetPassword, VerifyEmail } from "./modules/auth.jsx";
import { applyDevicePrefs, readDevicePrefs } from "./modules/core.jsx";
import { Home } from "./modules/feed.jsx";
import { Layout } from "./modules/layout.jsx";
import { installGlobalErrorReporting, PageErrorBoundary } from "./modules/errors.jsx";

// Áreas carregadas só quando se abrem (o JavaScript inicial fica muito mais pequeno).
const AdminPage = lazy(() => import("./modules/admin.jsx").then(module => ({ default: module.AdminPage })));
const Moderation = lazy(() => import("./modules/admin.jsx").then(module => ({ default: module.Moderation })));
const Create = lazy(() => import("./modules/create.jsx").then(module => ({ default: module.Create })));
const CreatorDashboard = lazy(() => import("./modules/creator.jsx").then(module => ({ default: module.CreatorDashboard })));
const Events = lazy(() => import("./modules/events.jsx").then(module => ({ default: module.Events })));
const Friends = lazy(() => import("./modules/friends.jsx").then(module => ({ default: module.Friends })));
const Groups = lazy(() => import("./modules/groups.jsx").then(module => ({ default: module.Groups })));
const AcademyPage = lazy(() => import("./modules/growth.jsx").then(module => ({ default: module.AcademyPage })));
const BrandsPage = lazy(() => import("./modules/growth.jsx").then(module => ({ default: module.BrandsPage })));
const ChallengesPage = lazy(() => import("./modules/growth.jsx").then(module => ({ default: module.ChallengesPage })));
const InvitePage = lazy(() => import("./modules/growth.jsx").then(module => ({ default: module.InvitePage })));
const StarsPage = lazy(() => import("./modules/growth.jsx").then(module => ({ default: module.StarsPage })));
const About = lazy(() => import("./modules/info.jsx").then(module => ({ default: module.About })));
const AdRules = lazy(() => import("./modules/info.jsx").then(module => ({ default: module.AdRules })));
const Help = lazy(() => import("./modules/info.jsx").then(module => ({ default: module.Help })));
const Privacy = lazy(() => import("./modules/info.jsx").then(module => ({ default: module.Privacy })));
const Terms = lazy(() => import("./modules/info.jsx").then(module => ({ default: module.Terms })));
const LivePage = lazy(() => import("./modules/live.jsx").then(module => ({ default: module.LivePage })));
const Messages = lazy(() => import("./modules/messages.jsx").then(module => ({ default: module.Messages })));
const Notifications = lazy(() => import("./modules/notifications.jsx").then(module => ({ default: module.Notifications })));
const Pages = lazy(() => import("./modules/pages.jsx").then(module => ({ default: module.Pages })));
const Profile = lazy(() => import("./modules/profile.jsx").then(module => ({ default: module.Profile })));
const Reels = lazy(() => import("./modules/reels.jsx").then(module => ({ default: module.Reels })));
const EditProfile = lazy(() => import("./modules/settings.jsx").then(module => ({ default: module.EditProfile })));
const Settings = lazy(() => import("./modules/settings.jsx").then(module => ({ default: module.Settings })));

// Enquanto a área pedida chega. Fica com o tamanho de uma página para não saltar.
function PageLoading() {
  return <section className="page narrow" aria-busy="true"><div className="empty card page-loading" role="status">A carregar...</div></section>;
}

function App() {
  // A fronteira de erro recomeça em cada página: um erro numa área não fica preso ao navegar.
  const { pathname } = useLocation();
  return <Layout><PageErrorBoundary key={pathname}><Suspense fallback={<PageLoading />}><Routes>
    <Route path="/" element={<Home />} />
    <Route path="/reels" element={<Reels />} />
    <Route path="/login" element={<Auth key="login" mode="login" />} />
    <Route path="/register" element={<Auth key="register" mode="register" />} />
    <Route path="/verify-email" element={<VerifyEmail />} />
    <Route path="/forgot-password" element={<ForgotPassword />} />
    <Route path="/reset-password" element={<ResetPassword />} />
    <Route path="/create" element={<Create />} />
    <Route path="/friends" element={<Friends />} />
    <Route path="/messages" element={<Messages />} />
    <Route path="/messages/:userId" element={<Messages />} />
    <Route path="/groups" element={<Groups />} />
    <Route path="/groups/:groupId" element={<Groups />} />
    <Route path="/pages" element={<Pages />} />
    <Route path="/pages/:pageId" element={<Pages />} />
    <Route path="/events" element={<Events />} />
    <Route path="/notifications" element={<Notifications />} />
    <Route path="/settings" element={<Settings />} />
    <Route path="/settings/:section" element={<Settings />} />
    <Route path="/profile/edit" element={<EditProfile />} />
    <Route path="/moderation" element={<Moderation />} />
    <Route path="/stats" element={<Navigate to="/creator/insights" replace />} />
    <Route path="/creator" element={<CreatorDashboard />} />
    <Route path="/estrelas" element={<StarsPage />} />
    <Route path="/marcas" element={<BrandsPage />} />
    <Route path="/desafios" element={<ChallengesPage />} />
    <Route path="/desafios/:challengeId" element={<ChallengesPage />} />
    <Route path="/convidar" element={<InvitePage />} />
    <Route path="/academia" element={<AcademyPage />} />
    <Route path="/live" element={<LivePage />} />
    <Route path="/live/:liveId" element={<LivePage />} />
    <Route path="/publicidade" element={<AdRules />} />
    <Route path="/admin" element={<AdminPage />} />
    <Route path="/admin/:tab" element={<AdminPage />} />
    <Route path="/creator/:section" element={<CreatorDashboard />} />
    <Route path="/about" element={<About />} />
    <Route path="/help" element={<Help />} />
    <Route path="/terms" element={<Terms />} />
    <Route path="/privacy" element={<Privacy />} />
    <Route path="/u/:username/about" element={<Profile />} />
    <Route path="/u/:username" element={<Profile />} />
  </Routes></Suspense></PageErrorBoundary></Layout>;
}
applyDevicePrefs(readDevicePrefs());
installGlobalErrorReporting();
createRoot(document.getElementById("root")).render(<BrowserRouter><App /></BrowserRouter>);
