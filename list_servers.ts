import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const servers = await prisma.vpnServer.findMany();
  console.log(JSON.stringify(servers, null, 2));
}
main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
