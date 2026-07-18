import Link from 'next/link';
import { ArrowLeft, FileText, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { PackingSegment } from '@/lib/packing-segments';

export function PackingClientSelection({ shipmentId, shipmentNumber, segments }: { shipmentId: number; shipmentNumber: number | null; segments: PackingSegment[] }) {
    return (
        <div className="min-h-screen bg-slate-50 p-8 dark:bg-slate-950">
            <div className="mx-auto max-w-2xl space-y-6">
                <Link href={`/shipments/${shipmentId}`}><Button variant="ghost" className="gap-2"><ArrowLeft className="h-4 w-4" /> Volver al envío</Button></Link>
                <Card>
                    <CardHeader>
                        <CardTitle>Seleccionar cliente para Packing List</CardTitle>
                        <CardDescription>El envío #{shipmentNumber || shipmentId} contiene productos de más de un cliente. Cada documento incluye únicamente el contenido confirmado de la cuenta elegida.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {segments.map((segment) => (
                            <div key={segment.clientId} className="flex items-center justify-between gap-4 border p-4">
                                <div className="min-w-0">
                                    <p className="flex items-center gap-2 font-semibold"><UserRound className="h-4 w-4 text-indigo-500" /> {segment.client.name}</p>
                                    <p className="mt-1 text-sm text-muted-foreground">{segment.itemCount} unidad(es) confirmada(s)</p>
                                </div>
                                <Button asChild className="shrink-0"><Link href={`/shipments/${shipmentId}/packing-list?clientId=${segment.clientId}`}><FileText className="mr-2 h-4 w-4" /> Abrir Packing</Link></Button>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
