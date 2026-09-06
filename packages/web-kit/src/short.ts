// The house elision for an address: enough of both ends to compare by eye.
export const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`
