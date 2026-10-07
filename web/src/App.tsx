import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Permission } from '@finbridge/shared';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { ActualsPage } from './pages/ActualsPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlatformPage } from './pages/PlatformPage';
import { ProfilePage } from './pages/ProfilePage';
import { AccountsPage } from './pages/admin/AccountsPage';
import { AdminCenterPage } from './pages/admin/AdminCenterPage';
import { AuditPage } from './pages/admin/AuditPage';
import { RolesPage } from './pages/admin/RolesPage';
import { BulkImportPage } from './pages/admin/BulkImportPage';
import { CompanyPage } from './pages/admin/CompanyPage';
import { CostCentersPage } from './pages/admin/CostCentersPage';
import { FinancialSettingsPage } from './pages/admin/FinancialSettingsPage';
import { OrgStructurePage } from './pages/admin/OrgStructurePage';
import { TemplatesPage } from './pages/admin/TemplatesPage';
import { UsersPage } from './pages/admin/UsersPage';
import { BudgetDetailPage } from './pages/budgets/BudgetDetailPage';
import { BudgetsPage } from './pages/budgets/BudgetsPage';
import { ChangeDetailPage } from './pages/changes/ChangeDetailPage';
import { ChangeFormPage } from './pages/changes/ChangeFormPage';
import { ChangesPage } from './pages/changes/ChangesPage';
import { ChangeReportPage } from './pages/reports/ChangeReportPage';
import { ConsumptionReportPage } from './pages/reports/ConsumptionReportPage';
import { WorkflowReportPage } from './pages/reports/WorkflowReportPage';
import { RequestDetailPage } from './pages/requests/RequestDetailPage';
import { RequestFormPage } from './pages/requests/RequestFormPage';
import { RequestsPage } from './pages/requests/RequestsPage';
import { SetupWizardPage } from './pages/setup/SetupWizardPage';
import { DelegationsPage } from './pages/workflow/DelegationsPage';
import { InboxPage } from './pages/workflow/InboxPage';
import { WorkflowBuilderPage } from './pages/workflow/WorkflowBuilderPage';
import { WorkflowListPage } from './pages/workflow/WorkflowListPage';

function Protected({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="boot"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function Need({ permission, any, children }: { permission: Permission; any?: Permission[]; children: ReactNode }) {
  const { can, user } = useAuth();
  if (!(any ?? [permission]).some((p) => can(p))) return <Navigate to={user?.role === 'SUPER_ADMIN' ? '/platform' : '/'} replace />;
  return <>{children}</>;
}

/** Landing page by role: platform operator → companies, pending setup → wizard, employee → requests. */
function Home() {
  const { user, can } = useAuth();
  if (user?.role === 'SUPER_ADMIN') return <Navigate to="/platform" replace />;
  if (user?.company && !user.company.setupCompleted && can('templates.apply')) return <Navigate to="/setup" replace />;
  if (!can('dashboard.view')) return <Navigate to={can('requests.view') ? '/requests' : '/approvals'} replace />;
  return <DashboardPage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Home />} />
        <Route path="approvals" element={<Need permission="masterdata.view"><InboxPage /></Need>} />

        <Route path="budgets" element={<Need permission="budget.view"><BudgetsPage /></Need>} />
        <Route path="budgets/:id" element={<Need permission="budget.view"><BudgetDetailPage /></Need>} />
        <Route path="changes" element={<Need permission="budget.view"><ChangesPage /></Need>} />
        <Route path="changes/new" element={<Need permission="change.create"><ChangeFormPage /></Need>} />
        <Route path="changes/:id/edit" element={<Need permission="change.create"><ChangeFormPage /></Need>} />
        <Route path="changes/:id" element={<Need permission="budget.view"><ChangeDetailPage /></Need>} />

        <Route path="requests" element={<Need permission="requests.view"><RequestsPage /></Need>} />
        <Route path="requests/new" element={<Need permission="request.create"><RequestFormPage /></Need>} />
        <Route path="requests/:id/edit" element={<Need permission="request.create"><RequestFormPage /></Need>} />
        <Route path="requests/:id" element={<Need permission="masterdata.view"><RequestDetailPage /></Need>} />
        <Route path="actuals" element={<Need permission="actuals.view"><ActualsPage /></Need>} />

        <Route path="reports/consumption" element={<Need permission="reports.view"><ConsumptionReportPage /></Need>} />
        <Route path="reports/workflows" element={<Need permission="reports.view"><WorkflowReportPage /></Need>} />
        <Route path="reports/changes" element={<Need permission="reports.view"><ChangeReportPage /></Need>} />

        <Route path="setup" element={<Need permission="templates.apply"><SetupWizardPage /></Need>} />
        <Route path="admin/organization" element={<Need permission="org.view"><OrgStructurePage /></Need>} />
        <Route path="admin/cost-centers" element={<Need permission="org.view"><CostCentersPage /></Need>} />
        <Route path="admin/accounts" element={<Need permission="coa.view"><AccountsPage /></Need>} />
        <Route path="admin/import" element={<Need permission="excel.import"><BulkImportPage /></Need>} />
        <Route path="admin/templates" element={<Need permission="templates.apply"><TemplatesPage /></Need>} />
        <Route path="admin/financial" element={<Need permission="coa.view" any={['coa.view', 'company.manage']}><FinancialSettingsPage /></Need>} />
        <Route path="admin/workflows" element={<Need permission="workflow.view"><WorkflowListPage /></Need>} />
        <Route path="admin/workflows/new" element={<Need permission="workflow.manage"><WorkflowBuilderPage /></Need>} />
        <Route path="admin/workflows/:id" element={<Need permission="workflow.view"><WorkflowBuilderPage /></Need>} />
        <Route path="delegations" element={<Need permission="masterdata.view"><DelegationsPage /></Need>} />
        <Route path="admin" element={<Need permission="users.view" any={['users.view', 'org.manage', 'coa.manage', 'workflow.manage', 'company.manage', 'audit.view']}><AdminCenterPage /></Need>} />
        <Route path="admin/users" element={<Need permission="users.view"><UsersPage /></Need>} />
        <Route path="admin/roles" element={<Need permission="users.view"><RolesPage /></Need>} />
        <Route path="admin/audit" element={<Need permission="audit.view"><AuditPage /></Need>} />
        <Route path="admin/company" element={<Need permission="company.view"><CompanyPage /></Need>} />
        <Route path="platform" element={<Need permission="platform.manage"><PlatformPage /></Need>} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
