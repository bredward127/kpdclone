import { useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import { StudioLayout } from "@/components/StudioLayout";
import Projects from "@/pages/Projects";
import StudioSection from "@/pages/StudioSection";
import { OperationsDashboard } from "@/components/OperationsDashboard";
import { ErrorState } from "@/components/States";

type SectionKey = "book-brief" | "blueprint" | "page-studio" | "cover-desk" | "validation" | "exports";
const sections = new Set<SectionKey>(["book-brief", "blueprint", "page-studio", "cover-desk", "validation", "exports"]);

function RootRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => setLocation("/projects"), [setLocation]);
  return null;
}

function NotFound() {
  return <ErrorState message="This studio route does not exist. Use the project navigation to continue." />;
}

function RoutedProjectSection({ projectId, section }: { projectId: string; section: string }) {
  if (!sections.has(section as SectionKey)) return <NotFound />;
  return <StudioSection projectId={projectId} section={section as SectionKey} />;
}

function AuthenticatedRoutes() {
  return (
    <Switch>
      <Route path="/" component={RootRedirect} />
      <Route path="/projects"><StudioLayout><Projects /></StudioLayout></Route>
      <Route path="/admin/operations"><StudioLayout><OperationsDashboard /></StudioLayout></Route>
      <Route path="/projects/:projectId/:section">{(params) => <StudioLayout projectId={params.projectId}><RoutedProjectSection projectId={params.projectId} section={params.section} /></StudioLayout>}</Route>
      <Route><StudioLayout><NotFound /></StudioLayout></Route>
    </Switch>
  );
}

export default function App() {
  return <AuthenticatedRoutes />;
}
