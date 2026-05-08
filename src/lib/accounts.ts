const ACCOUNTS_KEY = "ff-accounts";

export interface Account {
  username: string;
  passwordHash: string;
  displayName: string;
  kills: number;
  money: number;
}

function hashPassword(pw: string): string {
  let hash = 2166136261;
  for (let i = 0; i < pw.length; i++) {
    hash ^= pw.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16);
}

function loadAccounts(): Record<string, Account> {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveAccounts(accounts: Record<string, Account>) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function getAccount(username: string): Account | null {
  return loadAccounts()[username.toLowerCase()] ?? null;
}

export function createAccount(
  username: string,
  password: string,
  displayName: string
): Account | { error: string } {
  const accounts = loadAccounts();
  const key = username.toLowerCase();
  if (accounts[key]) return { error: "Username already taken." };
  if (username.length < 3) return { error: "Username must be at least 3 characters." };
  if (password.length < 4) return { error: "Password must be at least 4 characters." };
  const account: Account = {
    username: key,
    passwordHash: hashPassword(password),
    displayName: displayName.trim() || username,
    kills: 0,
    money: 0,
  };
  accounts[key] = account;
  saveAccounts(accounts);
  return account;
}

export function loginAccount(
  username: string,
  password: string
): Account | { error: string } {
  const account = getAccount(username);
  if (!account) return { error: "Account not found." };
  if (account.passwordHash !== hashPassword(password)) return { error: "Wrong password." };
  return account;
}

export function updateAccount(account: Account) {
  const accounts = loadAccounts();
  accounts[account.username] = account;
  saveAccounts(accounts);
}
