import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "../../../core/lib/supabase-server";

export async function POST(req: NextRequest) {
  const supabase = supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
