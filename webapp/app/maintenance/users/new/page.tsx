import { PrismaClient } from '@prisma/client';
import { UserForm } from '@/components/user-form';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

const prisma = new PrismaClient();

async function getClients() {
    return await prisma.client.findMany({
        orderBy: { name: 'asc' },
        select: {
            id: true,
            name: true,
            userId: true
        }
    });
}

export default async function NewUserPage() {
    const clients = await getClients();

    return (
        <div className="p-8 space-y-6">
            <div className="flex items-center gap-4">
                <Link href="/maintenance/users">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                        Nuevo Usuario
                    </h2>
                    <p className="text-muted-foreground">
                        Crea un usuario para acceso al sistema.
                    </p>
                </div>
            </div>

            <UserForm clients={clients} />
        </div>
    );
}
