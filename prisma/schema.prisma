generator client {
  provider = "prisma-client-js"
}
datasource db {
  provider = "sqlite"
  url = env("DATABASE_URL")
}
model Project {
  id String @id @default(cuid())
  name String
  brief String
  type String
  stage String @default("discover")
  requirements String
  sites String
  selectedSiteId String?
  designs String @default("[]")
  approvedDesignId String?
  weights String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  sensors Sensor[]
  incidents Incident[]
  messages Message[]
  simulations Simulation[]
}
model Sensor {
  id String @id @default(cuid())
  projectId String
  project Project @relation(fields:[projectId], references:[id], onDelete:Cascade)
  name String
  type String
  zone String
  x Float
  z Float
  floor Int @default(1)
  value Float
  threshold Float
  unit String
  source String @default("simulation")
  deviceId String?
  lastSeen DateTime?
  updatedAt DateTime @updatedAt
}
model Incident {
  id String @id @default(cuid())
  projectId String
  project Project @relation(fields:[projectId], references:[id], onDelete:Cascade)
  sensorId String
  kind String
  zone String
  severity String
  status String @default("open")
  message String
  recommendation String
  source String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
model Message {
  id String @id @default(cuid())
  projectId String
  project Project @relation(fields:[projectId], references:[id], onDelete:Cascade)
  role String
  content String
  createdAt DateTime @default(now())
}
model Simulation {
  id String @id @default(cuid())
  projectId String
  project Project @relation(fields:[projectId], references:[id], onDelete:Cascade)
  kind String
  summary String
  createdAt DateTime @default(now())
}
model AmenityCache {
  key String @id
  payload String
  updatedAt DateTime @updatedAt
}
model ProtectionWorkspace {
  id String @id
  snapshot String
  updatedAt DateTime @updatedAt
}
