import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Cloud } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TENANTS, useSession } from "@/lib/session";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in | Smart Cloud Task Engine" },
      {
        name: "description",
        content: "Sign in to the Smart Cloud Task Engine console to submit and monitor jobs.",
      },
      { property: "og:title", content: "Sign in | Smart Cloud Task Engine" },
      {
        property: "og:description",
        content: "Sign in to the Smart Cloud Task Engine console to submit and monitor jobs.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { user, signIn, setTenantId, tenantId } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@smartcloud.dev");
  const [password, setPassword] = useState("demo");
  const [tenant, setTenant] = useState(tenantId || "tenant-a");

  useEffect(() => {
    if (user) navigate({ to: "/", replace: true });
  }, [user, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center space-y-2 text-center">
          <Cloud className="h-10 w-10 text-primary" />
          <CardTitle className="text-2xl">Smart Cloud Task Engine</CardTitle>
          <p className="text-sm text-muted-foreground">
            Sign in to submit jobs and monitor the scheduler.
          </p>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!email.trim()) return;
              setTenantId(tenant);
              signIn(email.trim());
              navigate({ to: "/" });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tenant">Tenant</Label>
              <Select value={tenant} onValueChange={setTenant}>
                <SelectTrigger id="tenant">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TENANTS.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} · {t.plan}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full">
              Sign in
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Local console session — credentials are not sent anywhere.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
