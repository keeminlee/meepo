import NextAuth from "next-auth";
import { authOptions, assertProductionAuthEnvironment } from "@/lib/server/authOptions";

const handler = NextAuth(authOptions);

export async function GET(request: Request): Promise<Response> {
	assertProductionAuthEnvironment();
	return handler(request);
}

export async function POST(request: Request): Promise<Response> {
	assertProductionAuthEnvironment();
	return handler(request);
}
