import { portalRoadAppointments } from '../data/zwift-metadata.js';
import { worldName } from './routes.js';

function parseScheduleDate(value) {
  return new Date(String(value).replace(/([+-]\d{2})$/, '$1:00'));
}

export function getTodaysPortalRoad(now = new Date()) {
  const eligible = portalRoadAppointments
    .filter(item => parseScheduleDate(item.start) <= now)
    .sort((a, b) => parseScheduleDate(b.start) - parseScheduleDate(a.start));
  const active = eligible[0] ?? null;
  if (!active?.metadata) return null;

  return {
    id: active.road,
    name: active.metadata.name,
    distance: active.metadata.distance,
    elevation: active.metadata.elevation,
    world: active.world,
    worldName: worldName(active.world),
    portalOfMonth: Boolean(active.portalOfMonth),
    start: active.start,
  };
}
