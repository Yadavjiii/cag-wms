export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  officeId: string | null;
  departmentId: string | null;
  roleId: string | null;
  roleName: string | null;
  level: number;
  permissions: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
