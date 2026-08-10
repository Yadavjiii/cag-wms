import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import Dashboard from "./pages/Dashboard";
import Tasks from "./pages/Tasks";
import TaskDetail from "./pages/TaskDetail";
import Admin from "./pages/Admin";
import Departments from "./pages/Departments";
import Approvals from "./pages/Approvals";
import Meetings from "./pages/Meetings";
import Search from "./pages/Search";
import Reports from "./pages/Reports";
import Profile from "./pages/Profile";
import SuperAdmin from "./pages/SuperAdmin";
import Staff from "./pages/Staff";
import Offices from "./pages/Offices";
import ChangePassword from "./pages/ChangePassword";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Calendar from "./pages/Calendar";
import RolesAndDesignations from "./pages/RolesAndDesignations";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/meetings" element={<Meetings />} />
        <Route path="/search" element={<Search />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/superadmin" element={<SuperAdmin />} />
        <Route path="/staff" element={<Staff />} />
        <Route path="/offices" element={<Offices />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/roles" element={<RolesAndDesignations />} />
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="/departments" element={<Departments />} />
        <Route path="/profile" element={<Profile />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
