import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { createClient } from "../supabase/server";

export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error !== null) return null;
  return data.user;
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (user === null) redirect("/login");
  return user;
}
