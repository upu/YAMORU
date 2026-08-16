import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { createClient } from "../../../lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (data?.claims !== undefined) await supabase.auth.signOut();

  revalidatePath("/", "layout");
  // 相対Locationなら、LAN内のiPhoneで開いたホストをブラウザがそのまま使う。
  // NextRequest内部のoriginは開発サーバー側のlocalhostになりうるため使わない。
  return new NextResponse(null, {
    headers: { Location: "/login" },
    status: 303,
  });
}
