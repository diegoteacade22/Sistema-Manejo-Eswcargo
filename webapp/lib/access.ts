import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export async function requireAuthenticatedUser() {
    const session = await auth();
    if (!session?.user) {
        redirect("/login");
    }
    return session;
}

export async function requireAdminUser() {
    const session = await requireAuthenticatedUser();
    if ((session.user as any).role !== "ADMIN") {
        redirect("/");
    }
    return session;
}
