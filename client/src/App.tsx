import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import Dashboard from "./pages/Dashboard";
import Tasks from "./pages/Tasks";
import TaskDetail from "./pages/TaskDetail";
import Teams from "./pages/Teams";
import Admin from "./pages/Admin";
import Departments from "./pages/Departments";
import Approvals from "./pages/Approvals";
import Meetings from "./pages/Meetings";
import Search from "./pages/Search";
import Reports from "./pages/Reports";
import Profile from "./pages/Profile";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
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
        <Route path="/teams" element={<Teams />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/departments" element={<Departments />} />
        <Route path="/profile" element={<Profile />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
