import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { landingPath } from '@/config/permissions';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import StoresPage from '@/pages/StoresPage';
import ProductsPage from '@/pages/ProductsPage';
import OrdersPage from '@/pages/OrdersPage';
import PrescriptionsPage from '@/pages/PrescriptionsPage';
import ActivationsPage from '@/pages/ActivationsPage';
import ActivationDetailPage from '@/pages/ActivationDetailPage';
import LabOrdersPage from '@/pages/LabOrdersPage';
import AppointmentsPage from '@/pages/AppointmentsPage';
import LabsPage from '@/pages/LabsPage';
import AdminsPage from '@/pages/AdminsPage';
import UsersPage from '@/pages/UsersPage';
import NoAccessPage from '@/pages/NoAccessPage';

export default function App() {
  const { user, loading } = useAuth();
  const home = user ? landingPath(user.role) : '/login';

  if (loading) {
    return (
      <div className="grid h-full place-items-center bg-slate-100 text-sm text-slate-500">
        <div className="flex items-center gap-2">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
          Checking your session…
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to={home} replace /> : <LoginPage />}
      />

      <Route element={<DashboardLayout />}>
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute module="dashboard">
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/stores"
          element={
            <ProtectedRoute module="stores">
              <StoresPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/products"
          element={
            <ProtectedRoute module="products">
              <ProductsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/orders"
          element={
            <ProtectedRoute module="orders">
              <OrdersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/prescriptions"
          element={
            <ProtectedRoute module="prescriptions">
              <PrescriptionsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/activations"
          element={
            <ProtectedRoute module="activations">
              <ActivationsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/activations/:id"
          element={
            <ProtectedRoute module="activations">
              <ActivationDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lab-orders"
          element={
            <ProtectedRoute module="lab_orders">
              <LabOrdersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lab-tests"
          element={
            <ProtectedRoute module="lab_tests">
              <LabsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/appointments"
          element={
            <ProtectedRoute module="appointments">
              <AppointmentsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/users"
          element={
            <ProtectedRoute module="users">
              <UsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admins"
          element={
            <ProtectedRoute module="admins">
              <AdminsPage />
            </ProtectedRoute>
          }
        />
        <Route path="/no-access" element={<NoAccessPage />} />
      </Route>

      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}
