import { NextResponse } from 'next/server';
import { apiRoute } from '@/lib/api-route';
import { readJarvisView } from '@/lib/jarvis-discovery';
import { readOutreachAutomation } from '@/extension/robin/outreach-automation-domain';
import { buildAutomationView } from '@/extension/robin/outreach-automation-view';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const GET = apiRoute(() => NextResponse.json(buildAutomationView(readJarvisView(), readOutreachAutomation()), {headers: {'Cache-Control':'no-store'}}));
