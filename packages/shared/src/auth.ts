export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

export type SessionPayload = {
  user: AuthUser;
};
