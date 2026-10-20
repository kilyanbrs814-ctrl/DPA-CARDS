// A short one-time code is verified server-side by Supabase Auth.
// Never persist or log this value.
export const isSixDigitCode = value => typeof value === 'string' && /^[0-9]{6}$/.test(value.trim());
