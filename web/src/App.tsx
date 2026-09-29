import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Permission } from '@finbridge/shared';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { ActualsPage } from './pages/ActualsPage';
import { BudgetDetailPage } from './pages/BudgetDetailPage';
import { BudgetsPage } from './pages/BudgetsPage';
import { CompanyPage } from './pages/CompanyPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { AccountsPage, CostCentersPage, DepartmentsPage } from './pages/MasterDataPages';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlanVsActualPage } from './pages/PlanVsActualPage';
import { PlatformPage } from './pages/PlatformPage';
import { ProfilePage } from './pages/ProfilePage';
import { UsersPage } from './pages/UsersPage';

function Protected({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="boot"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function Need({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can, user } = useAuth();
  if (!can(permission)) return <Navigate to={user?.role === 'SUPER_ADMIN' ? '/platform' : '/'} replace />;
  return <>{children}</>;
}

function Home() {
  const { user } = useAuth();
  if (user?.role === 'SUPER_ADMIN') return <Navigate to="/platform" replace />;
  return <DashboardPage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Home />} />
        <Route path="budgets" element={<Need permission="budget.view"><BudgetsPage /></Need>} />
        <Route path="budgets/:id" element={<Need permission="budget.view"><BudgetDetailPage /></Need>} />
        <Route path="plan-vs-actual" element={<Need permission="reports.view"><PlanVsActualPage /></Need>} />
        <Route path="actuals" element={<Need permission="actuals.view"><ActualsPage /></Need>} />
        <Route path="departments" element={<Need permission="masterdata.view"><DepartmentsPage /></Need>} />
        <Route path="cost-centers" element={<Need permission="masterdata.view"><CostCentersPage /></Need>} />
        <Route path="accounts" element={<Need permission="masterdata.view"><AccountsPage /></Need>} />
        <Route path="users" element={<Need permission="users.manage"><UsersPage /></Need>} />
        <Route path="company" element={<Need permission="masterdata.view"><CompanyPage /></Need>} />
        <Route path="platform" element={<Need permission="platform.manage"><PlatformPage /></Need>} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
