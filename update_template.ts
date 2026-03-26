import { prisma } from "./src/utils/prisma";

async function main() {
  const template =
    "vless://{uuid}@89.169.54.87:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=google.com&fp=chrome&pbk=4kh0XQFo3wcPOnAU-o_Nokc3WQGWUVQEPQBurWHxUBM&sid=e12b6c973e573780&packetEncoding=xudp#lowkey-Frankfurt Am Main, DE";

  const result = await prisma.vpnServer.updateMany({
    where: { ip: "89.169.54.87" },
    data: {
      connectLinkTemplate: template,
    },
  });

  console.log(`Updated ${result.count} servers.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
