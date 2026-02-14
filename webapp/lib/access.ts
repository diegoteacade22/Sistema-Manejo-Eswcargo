import { auth } from "@/lib/auth";

export async function requireAuthenticatedUser() {
    const session = await auth();
    if (!session?.user) {
        throw new Error("Unauthorized");
    }
    return session;
}

export async function requireAdminUser() {
    const session = await requireAuthenticatedUser();
    if ((session.user as any).role !== "ADMIN") {
        throw new Error("Forbidden");
    }
    return session;
}

