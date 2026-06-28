export type IpaIdentity = {
  uid: string;
  mail: string | null;
};

export const selectStaleLocalIpaRows = <T extends IpaIdentity>(params: { localRows: T[]; activeRemoteUsers: IpaIdentity[] }): T[] => {
  const activeUids = new Set(params.activeRemoteUsers.map((user) => user.uid));
  const activeMails = new Set(params.activeRemoteUsers.map((user) => user.mail).filter((mail): mail is string => Boolean(mail)));

  return params.localRows.filter((row) => {
    if (activeUids.has(row.uid)) return false;
    if (row.mail && activeMails.has(row.mail)) return false;
    return true;
  });
};
