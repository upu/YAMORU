import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { signOut } from "../../../auth";

export async function POST() {
  await signOut({ redirect: false });

  revalidatePath("/", "layout");
  // 相対Locationなら、LAN内のiPhoneで開いたホストをブラウザがそのまま使う。
  // NextRequest内部のoriginは開発サーバー側のlocalhostになりうるため使わない。
  return new NextResponse(null, {
    headers: { Location: "/login" },
    status: 303,
  });
}
