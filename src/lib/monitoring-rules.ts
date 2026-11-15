// Shared HAVEN threshold defaults and response wording for hardware and simulation.
export const sensorDefaults: Record<
  string,
  { value: number; threshold: number; unit: string; label: string }
> = {
  temperature: { value: 22, threshold: 38, unit: '°C', label: 'Temperature' },
  water: { value: 0, threshold: 30, unit: '%', label: 'Water leak' },
  fire: { value: 0, threshold: 1, unit: 'alarm', label: 'Smoke / fire' },
  electrical: { value: 45, threshold: 85, unit: '% load', label: 'Electrical load' },
};
export function incidentDetails(type: string, zone: string, value: number, source: string) {
  const kind =
    type === 'water'
      ? 'water-leak'
      : type === 'temperature'
        ? 'overheating'
        : type === 'fire'
          ? 'fire-alarm'
          : 'electrical-overload';
  const recommendation =
    type === 'water'
      ? 'Maintenance agent: inspect nearby plumbing and isolate the affected area through qualified personnel. Log findings before resolving.'
      : type === 'temperature'
        ? 'Maintenance agent: inspect HVAC, ventilation and equipment loads. Have qualified personnel assess the temperature rise.'
        : type === 'fire'
          ? 'Guardian: follow the site emergency plan, evacuate when appropriate, and contact emergency services if there is a real fire. This application does not operate alarms or suppression equipment.'
          : 'Maintenance agent: ask a qualified electrician to inspect circuit loading and equipment. Do not remotely switch life-safety systems.';
  return {
    kind,
    zone,
    severity: type === 'fire' ? 'critical' : 'high',
    message: `${source === 'hardware' ? 'Hardware' : 'Simulated'} ${kind.replaceAll('-', ' ')} detected in ${zone} (reading ${value}). Monitoring agent → Guardian → maintenance response.`,
    recommendation,
    source,
  };
}
