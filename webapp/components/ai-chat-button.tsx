
'use client';

import { useState, useRef, useEffect } from 'react';
import { Bot, X, Send, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

export function AiChatButton() {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        { role: 'assistant', content: '¡Hola! Soy tu asistente inteligente. ¿En qué puedo ayudarte hoy con tus datos?' }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMsg = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setIsLoading(true);

        try {
            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userMsg })
            });

            if (!res.ok) throw new Error('Error en la respuesta');
            const data = await res.json();

            setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
        } catch (error) {
            setMessages(prev => [...prev, { role: 'assistant', content: 'Lo siento, no pude conectarme al asistente.' }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-4">
            {isOpen && (
                <Card className="w-[380px] h-[500px] shadow-2xl border-indigo-500/20 flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 duration-300">
                    <CardHeader className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white p-4">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-sm font-bold flex items-center gap-2">
                                <Sparkles className="h-4 w-4" /> Asistente Eswcargo IA
                            </CardTitle>
                            <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)} className="text-white hover:bg-white/20 h-8 w-8">
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50 dark:bg-slate-950">
                        {messages.map((msg, i) => (
                            <div key={i} className={cn(
                                "flex flex-col max-w-[85%] rounded-2xl p-3 text-sm",
                                msg.role === 'user'
                                    ? "ml-auto bg-indigo-600 text-white rounded-br-none"
                                    : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-bl-none shadow-sm"
                            )}>
                                {msg.content}
                            </div>
                        ))}
                        {isLoading && (
                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl rounded-bl-none p-3 max-w-[85%] shadow-sm">
                                <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                            </div>
                        )}
                    </CardContent>
                    <CardFooter className="p-3 border-t bg-white dark:bg-slate-900">
                        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-2 w-full">
                            <input
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder="Escribe tu consulta..."
                                className="flex-1 bg-slate-100 dark:bg-slate-800 border-none rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                            <Button type="submit" size="icon" disabled={isLoading} className="rounded-full bg-indigo-600 hover:bg-indigo-700 shrink-0">
                                <Send className="h-4 w-4" />
                            </Button>
                        </form>
                    </CardFooter>
                </Card>
            )}

            <Button
                onClick={() => setIsOpen(!isOpen)}
                size="icon"
                className={cn(
                    "h-14 w-14 rounded-full shadow-2xl transition-all duration-300",
                    isOpen ? "bg-slate-200 text-slate-600 hover:bg-slate-300 rotate-90" : "bg-gradient-to-r from-indigo-600 to-violet-600 text-white scale-110 hover:scale-125"
                )}
            >
                {isOpen ? <X className="h-7 w-7" /> : <Bot className="h-7 w-7" />}
            </Button>
        </div>
    );
}
