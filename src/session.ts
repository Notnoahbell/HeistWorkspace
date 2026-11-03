// The current user. The sync server assigns the id (for now a hash of the
// visitor's IP, for testing); it's cached so the right Home loads instantly on
// the next visit. Offline, before ever connecting, you're "local".
// Every user has a private Home board at the root of their board tree.

const KEY = 'heist:user';

function read(): string {
  try { return localStorage.getItem(KEY) || 'local'; } catch { return 'local'; }
}

let userId = read();

export const session = {
  get userId() { return userId; },
};

export const homeId = (id: string = userId) => `home:${id}`;
export const isHome = (boardId: string) => boardId.startsWith('home:');

/** Switch to the server-assigned id. Returns the previous one. */
export function setSessionUser(id: string): string {
  const prev = userId;
  userId = id;
  try { localStorage.setItem(KEY, id); } catch {}
  return prev;
}
