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
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-balance text-foreground">
        Historial Médico — en construcción
      </h1>
      <p className="max-w-md text-lg text-muted-foreground">
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
