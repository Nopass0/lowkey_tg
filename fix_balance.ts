import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { login: "lprts2" },
  });

  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: { balance: 500 }, // Fix balance to 500
    });
    console.log("Updated balance to 500 for lprts2");
  } else {
    console.log("User lprts2 not found");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
