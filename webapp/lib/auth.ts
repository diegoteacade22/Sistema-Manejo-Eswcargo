
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
                console.log("Authorize called with:", credentials?.username);

                // BYPASS PARA DEV/STAGING
                const isDev = process.env.NEXT_PUBLIC_APP_ENV === 'staging' || process.env.NODE_ENV === 'development';

                if (isDev && credentials?.username === 'admin' && credentials?.password === 'admin123') {
                    console.log("🔓 DEV MODE: Bypassing auth for admin");

                    // Buscar si existe el usuario admin para devolver sus datos reales
                    const adminUser = await (prisma as any).user.findUnique({
                        where: { username: 'admin' },
                    });

                    if (adminUser) {
                        return {
                            id: adminUser.id,
                            name: adminUser.name,
                            email: adminUser.email,
                            role: adminUser.role,
                        };
                    }

                    // Fallback si no existe en BD (aunque debería)
                    return {
                        id: "admin-bypass",
                        name: "Admin Bypass",
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
