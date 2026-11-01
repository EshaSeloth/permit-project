// Display-only labels for the demo users. Internal usernames stay the source of truth for data and permissions.
interface UserDisplay {
  name: string;
  roleLine: string;
}

const USER_DISPLAY: Record<string, UserDisplay> = {
  am_meridian: { name: "Priya", roleLine: "Account Manager · Meridian Freight" },
  am_brightpath: { name: "Marco", roleLine: "Account Manager · Brightpath Health" },
  support1: { name: "Aisha", roleLine: "Support Agent · all customers" },
  pm1: { name: "Dana", roleLine: "Product Manager · all customers" },
  exec1: { name: "Jordan", roleLine: "Executive · all customers" },
  ex_am: { name: "Sam", roleLine: "Former employee · access removed" },
};

export function displayName(username: string): string {
  return USER_DISPLAY[username]?.name ?? username;
}

export function displayRoleLine(username: string): string | undefined {
  return USER_DISPLAY[username]?.roleLine;
}
