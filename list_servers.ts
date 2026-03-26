import { prisma } from "./src/utils/prisma";
async function main() {
  const servers = await prisma.vpnServer.findMany();
  console.log(JSON.stringify(servers, null, 2));
}
main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
