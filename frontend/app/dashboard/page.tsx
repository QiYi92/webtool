"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

type ToolsResponse = Record<string, unknown> | null;

export default function DashboardPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [toolsResponse, setToolsResponse] = useState<ToolsResponse>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !data.session) {
        router.replace("/login");
        return;
      }

      if (!active) {
        return;
      }

      const { user, access_token: accessToken } = data.session;
      setUserId(user.id);
      setUserEmail(user.email ?? null);

      try {
        const response = await fetch("http://127.0.0.1:8888/tools/", {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        });
        const json = await response.json();
        setToolsResponse(json);
        if (!response.ok) {
          setError("Failed to fetch tools");
        }
      } catch (fetchError) {
        setError("Failed to fetch tools");
      } finally {
        setLoading(false);
      }
    };

    load();

    return () => {
      active = false;
    };
  }, [router]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (loading) {
    return <main>Loading...</main>;
  }

  return (
    <main>
      <h1>Dashboard</h1>
      <p>User ID: {userId ?? "unknown"}</p>
      <p>Email: {userEmail ?? "unknown"}</p>
      <button type="button" onClick={handleSignOut}>
        Sign out
      </button>
      <h2>Tools API Response</h2>
      {error ? <p>{error}</p> : null}
      <pre>{JSON.stringify(toolsResponse, null, 2)}</pre>
    </main>
  );
}
