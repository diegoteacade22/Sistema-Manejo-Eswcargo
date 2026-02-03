
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const { handlers, auth, signIn, signOut } = NextAuth({
    ...authConfig,
    providers: [
        Credentials({
            name: "Client Number",
            credentials: {
                username: { label: "Usuario (Admin o Nro Cliente)", type: "text" },
                password: { label: "Contraseña", type: "password" },
            },
            async authorize(credentials) {
                // BYPASS TOTAL DE EMERGENCIA
                if (credentials?.username === 'admin') {
                    return {
                        id: "admin-id",
                        name: "Administrador",
                        email: "admin@eswcargo.com",
                        role: "ADMIN",
                    };
                }

                if (!credentials?.username || !credentials?.password) {
                    console.log("Missing credentials");
                    return null;
                }

                const user = await (prisma as any).user.findUnique({
                    where: { username: credentials.username },
                });

                if (!user || !user.password) {
                    console.log("User not found or no password");
                    return null;
                }

                const isPasswordValid = await bcrypt.compare(
                    credentials.password as string,
                    user.password
                );

                console.log("Password valid:", isPasswordValid);

                if (!isPasswordValid) return null;

                return {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                };
            },
        }),
    ],
});
