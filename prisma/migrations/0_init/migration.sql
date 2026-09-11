-- CreateEnum
CREATE TYPE "BookingMode" AS ENUM ('TOKEN', 'SLOT', 'HYBRID');

-- CreateEnum
CREATE TYPE "AppointmentType" AS ENUM ('TOKEN', 'SLOT');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'ARRIVED', 'IN_PROGRESS', 'DONE', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('EN', 'KN');

-- CreateTable
CREATE TABLE "doctors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clinic_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp_phone_number_id" TEXT,
    "booking_mode" "BookingMode" NOT NULL DEFAULT 'TOKEN',
    "booking_mode_locked_at" TIMESTAMP(3),
    "daily_token_cap" INTEGER NOT NULL DEFAULT 40,
    "consult_duration_mins" INTEGER NOT NULL DEFAULT 10,
    "avg_consult_time_mins" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "consult_sample_count" INTEGER NOT NULL DEFAULT 0,
    "working_hours" JSONB NOT NULL,
    "leave_dates" DATE[],
    "default_language" "Language" NOT NULL DEFAULT 'EN',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "api_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "language" "Language" NOT NULL DEFAULT 'EN',
    "last_visit_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" "AppointmentType" NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "token_number" INTEGER,
    "slot_start" TIMESTAMP(3),
    "slot_end" TIMESTAMP(3),
    "arrived_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "consult_mins" INTEGER,
    "day_before_reminder_sent_at" TIMESTAMP(3),
    "hour_before_reminder_sent_at" TIMESTAMP(3),
    "last_notified_position" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_states" (
    "id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "last_issued_token" INTEGER NOT NULL DEFAULT 0,
    "now_serving_token" INTEGER,
    "delay_mins" INTEGER NOT NULL DEFAULT 0,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_sessions" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "patient_id" TEXT,
    "language" "Language" NOT NULL DEFAULT 'EN',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_messages" (
    "provider_message_id" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_messages_pkey" PRIMARY KEY ("provider_message_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "doctors_whatsapp_phone_number_id_key" ON "doctors"("whatsapp_phone_number_id");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_api_key_key" ON "doctors"("api_key");

-- CreateIndex
CREATE UNIQUE INDEX "patients_phone_key" ON "patients"("phone");

-- CreateIndex
CREATE INDEX "appointments_doctor_id_date_status_idx" ON "appointments"("doctor_id", "date", "status");

-- CreateIndex
CREATE INDEX "appointments_patient_id_date_idx" ON "appointments"("patient_id", "date");

-- CreateIndex
CREATE INDEX "appointments_status_slot_start_idx" ON "appointments"("status", "slot_start");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_doctor_id_date_token_number_key" ON "appointments"("doctor_id", "date", "token_number");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_doctor_id_slot_start_key" ON "appointments"("doctor_id", "slot_start");

-- CreateIndex
CREATE UNIQUE INDEX "queue_states_doctor_id_date_key" ON "queue_states"("doctor_id", "date");

-- CreateIndex
CREATE INDEX "conversation_sessions_expires_at_idx" ON "conversation_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_sessions_phone_doctor_id_key" ON "conversation_sessions"("phone", "doctor_id");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_states" ADD CONSTRAINT "queue_states_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_sessions" ADD CONSTRAINT "conversation_sessions_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_sessions" ADD CONSTRAINT "conversation_sessions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

