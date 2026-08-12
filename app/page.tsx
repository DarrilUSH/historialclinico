import { HeartPulse } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 px-6 text-center font-sans dark:bg-black">
      <h1 className="text-4xl font-bold text-zinc-900 dark:text-zinc-50">
        Historial Médico — en construcción
      </h1>
      <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">
        Estamos preparando tu historial médico. Muy pronto vas a poder
        acceder a toda tu información acá.
      </p>
      <Card className="w-full max-w-sm text-left">
        <CardHeader>
          <CardTitle>Prueba de componentes</CardTitle>
          <CardDescription>
            Verificación de shadcn/ui y Lucide React funcionando en el
            proyecto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button>
            <HeartPulse />
            Ver mi historial
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
