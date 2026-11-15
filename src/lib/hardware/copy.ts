// Wording for the Live hardware panel, by project type. The physical model is the same kit for every
// project (leak probe + shutoff valve, DHT11, fan, PIR, RFID, buzzer); only a data center also runs
// the "servers" (measured laptop power) and the grid-event workflow.

export type HardwareCopy = {
  dataCenter: boolean;
  leak: { title: string; okTag: string };
  climate: { title: string; tag: string };
  fan: { title: string };
  people: { title: string; empty: string; occupied: string };
};

export function isDataCenter(type: string | null | undefined): boolean {
  return /data\s*cent(er|re)/i.test(type ?? '');
}

export function hardwareCopy(type: string | null | undefined): HardwareCopy {
  if (isDataCenter(type))
    return {
      dataCenter: true,
      leak: { title: 'Coolant loop', okTag: 'dry' },
      climate: { title: 'Hot aisle', tag: 'DHT11' },
      fan: { title: 'Cooling' },
      people: {
        title: 'People in the hall',
        empty: 'No one detected near the racks.',
        occupied: 'The AI adds evacuation steps to any alarm.',
      },
    };
  return {
    dataCenter: false,
    leak: { title: 'Water leak', okTag: 'dry' },
    climate: { title: 'Temperature & humidity', tag: 'DHT11' },
    fan: { title: 'Ventilation' },
    people: {
      title: 'People on site',
      empty: 'No one detected in the monitored area.',
      occupied: 'The AI adds evacuation steps to any alarm.',
    },
  };
}
