import { getChatGPTUser } from '../chatgpt-auth';

export async function requireUser() {
  const user = await getChatGPTUser();
  if (user) return user;
  if (process.env.NODE_ENV !== 'production') {
    return { userId: 'local-single-user', displayName: 'Food journal', email: 'local@mise.app', fullName: null };
  }
  return null;
}
