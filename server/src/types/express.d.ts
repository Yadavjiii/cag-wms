export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  officeId: string | null;
  officeName: string | null;
  departmentId: string | null;
  roleId: string | null;
  roleName: string | null;
  level: number;
  isActive: boolean;
  deletedAt?: Date | null;
  mustChangePassword: boolean;
  /** Offices this user is the head of (DG / PAG / DAG etc.). */
  headsOfficeIds: string[];
  /** Departments this user is the head of. */
  headsDepartmentIds: string[];
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
