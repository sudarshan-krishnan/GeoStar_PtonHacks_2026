import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  defaultProtections,
  type Facility,
  type ProtectionAction,
  type ProtectionState,
} from '../../src/lib/haven/engine';

const facility: Facility = {
  id: 'd2-northline-data-center-houston',
  name: 'Northline Campus',
  city: 'Houston, Texas',
  type: 'Data center',
};
const pathFor = (f: Facility) => `/api/protection/${f.id}`;
async function read(request: APIRequestContext, f = facility): Promise<ProtectionState> {
  const response = await request.get(
    `${pathFor(f)}?${new URLSearchParams({ name: f.name, city: f.city, type: f.type })}`,
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
test('protection API isolates facilities, validates deployment and rejects stale or cross-origin writes', async ({
  request,
}) => {
  const a = { ...facility, id: `haven-test-${Date.now()}-a` },
    b = { ...facility, id: `haven-test-${Date.now()}-b` };
  let state = await read(request, a);
  const send = async (command: ProtectionAction, status = 200) => {
    const response = await request.patch(pathFor(a), {
      data: { facility: a, revision: state.revision, command },
    });
    expect(response.status(), await response.text()).toBe(status);
    if (status === 200) state = await response.json();
  };
  await send({ action: 'deploy' }, 409);
  await send({ action: 'accept-model' });
  await send({
    action: 'configure',
    config: {
      ...defaultProtections,
      electricity: { enabled: true, limit: 400 },
      fire: { enabled: false },
    },
  });
  await send({ action: 'trigger', kind: 'fire' }, 409);
  const stale = await request.patch(pathFor(a), {
    data: { facility: a, revision: 0, command: { action: 'place', plan: 'north' } },
  });
  expect(stale.status()).toBe(409);
  await send({ action: 'place', plan: 'north' });
  await send({ action: 'deploy' });
  const other = await read(request, b);
  expect(other.modelAccepted).toBe(false);
  expect(other.config.electricity.limit).toBe(500);
  expect(other.deployed).toBe(false);
  expect((await read(request, a)).config.electricity.limit).toBe(400);
  const blocked = await request.patch(pathFor(a), {
    headers: { Origin: 'https://unrelated.example' },
    data: { facility: a, revision: state.revision, command: { action: 'reset' } },
  });
  expect(blocked.status()).toBe(403);
});
