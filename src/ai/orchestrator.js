import { openai, AI_MODEL } from './openai.js';
import * as clientService from '../services/clientService.js';
import * as petService from '../services/petService.js';
import * as appointmentService from '../services/appointmentService.js';
import { sql } from '../database/supabase.js';

/**
 * Main orchestrator function that processes incoming messages.
 * Returns the text response to send back to the user.
 */
export async function processMessage({ phone, messageText, clinicId, socketEmitter }) {
  try {
    // 1. Resolve/Find Client
    let client = await clientService.getClientByPhone(phone, clinicId);
    let pets = [];
    let nextAppointment = null;

    if (!client) {
      // Create a temporary profile for the customer since they don't exist yet
      console.log(`👤 New client writing from +${phone}. Registering...`);
      client = await clientService.createClient({
        name: `Cliente WhatsApp (+${phone.slice(-4)})`,
        phone: phone,
        clinicId: clinicId
      });
      // Notify panel about new client
      if (socketEmitter) {
        socketEmitter('new_client', { clinicId, client });
      }
    } else {
      // Fetch Client's pets
      pets = await petService.getPetsByClientId(client.id, clinicId);
      
      // Get next scheduled appointment for any of their pets
      if (pets.length > 0) {
        for (const pet of pets) {
          const appt = await appointmentService.getNextAppointmentForPet(pet.id, clinicId);
          if (appt) {
            nextAppointment = { ...appt, petName: pet.name };
            break;
          }
        }
      }
    }

    // 2. Fetch Chat History from the Database
    const historyRows = await sql`
      SELECT role, message as content FROM messages
      WHERE clinic_id = ${clinicId} AND phone = ${phone}
      ORDER BY created_at DESC
      LIMIT 12
    `;
    // We reverse historyRows because we queried DESC to limit it, but want ASC order for the LLM
    const history = historyRows.reverse();

    // 3. Save User Message to Database
    await sql`
      INSERT INTO messages (clinic_id, phone, message, role, status)
      VALUES (${clinicId}, ${phone}, ${messageText}, 'user', 'read')
    `;
    if (socketEmitter) {
      socketEmitter('new_message', {
        clinicId,
        phone,
        message: messageText,
        role: 'user',
        status: 'read',
        createdAt: new Date().toISOString()
      });
    }

    // Check if human agent has taken over
    if (client.conversation_mode === 'human') {
      console.log(`🤖 Human Agent Takeover Active for +${phone}. Valentina (AI) is paused.`);
      return null;
    }


    // 4. Construct AI context
    const currentDateStr = new Date().toLocaleDateString('es-ES', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const currentTimeStr = new Date().toLocaleTimeString('es-ES', {
      hour: '2-digit', minute: '2-digit'
    });

    const petsText = pets.length > 0 
      ? pets.map(p => `- ${p.name} (Especie: ${p.species}, Raza: ${p.breed}, Edad: ${p.age}, Peso: ${p.weight || 'N/A'}, Sexo: ${p.sex || 'Macho'})`).join('\n')
      : 'Ninguna registrada aún.';

    const appointmentText = nextAppointment 
      ? `Próxima Cita Reservada: Mascota: ${nextAppointment.petName}, Fecha: ${nextAppointment.date}, Hora: ${nextAppointment.time}, Tipo: ${nextAppointment.type}, Estado: ${nextAppointment.status}`
      : 'Ninguna cita programada activa.';

    const systemPrompt = `Eres Valentina, la recepcionista real de la clínica veterinaria VetControl.

NUNCA debes decir que eres una IA, inteligencia artificial, chatbot o asistente virtual. Comportate siempre como una señorita recepcionista real: educada, amable, tranquila, cálida, profesional y humana.

INFORMACIÓN DEL CLIENTE:
- Nombre: ${client.name}
- Teléfono: ${client.phone}
- Mascotas: 
${petsText}
- Citas Activas:
${appointmentText}

FECHA/HORA ACTUAL DEL SISTEMA:
- ${currentDateStr} a las ${currentTimeStr}

REGLAS DE COMPORTAMIENTO:
1. Respuestas cortas, claras, profesionales y naturales.
2. Si detectas que el usuario desea programar/agendar una cita pero no especifica fecha u hora, debes preguntárselo amablemente.
3. Si el usuario indica fecha y hora para agendar, o cancelar, o reprogramar, debes confirmar los datos de forma natural y retornar el intent adecuado.
4. Si menciona alguna emergencia médica (sangrado, convulsiones, envenenamiento, dificultad extrema para respirar, fracturas graves, etc.), catalógalo de urgencia alta y recomiéndale venir de inmediato a emergencias.
5. Si no entiendes el mensaje (palabras sin sentido o memes), responde: "No entendí muy bien 😅 ¿Podrías explicarme un poco más?"
6. Si responde "SI" o "NO" confirmando o cancelando la cita pendiente, cataloga el intent correspondiente.

DEBES RESPONDER EXCLUSIVAMENTE EN FORMATO JSON con la siguiente estructura:
{
  "response": "El mensaje de texto amigable que Valentina le enviará al cliente por WhatsApp",
  "intent": "none" | "book_appointment" | "cancel_appointment" | "reschedule_appointment" | "confirm_appointment" | "escalate",
  "details": {
    "pet_name": "Nombre de la mascota (si se menciona, ej. Rocky)",
    "date": "Fecha en formato AAAA-MM-DD (si se menciona o deduce)",
    "time": "Hora en formato HH:MM (si se menciona, ej. 16:00)",
    "reason": "Motivo de la cita (si se menciona, ej. vacuna, consulta)"
  }
}`;

    // 5. Query the LLM
    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: messageText }
    ];

    const completion = await openai.chat.completions.create({
      model: AI_MODEL,
      messages: apiMessages,
      response_format: { type: 'json_object' }
    });

    const resultJsonStr = completion.choices[0].message.content;
    let aiResponse;
    try {
      aiResponse = JSON.parse(resultJsonStr);
    } catch (parseErr) {
      console.error('Failed to parse AI JSON response, falling back to raw text. Content:', resultJsonStr);
      aiResponse = {
        response: resultJsonStr || 'Disculpa, ¿podrías repetir eso?',
        intent: 'none',
        details: {}
      };
    }

    console.log(`🤖 AI Intent: ${aiResponse.intent}`, aiResponse.details);

    // 6. Execute Programmatic DB Action based on AI Intent
    let finalResponseText = aiResponse.response;
    const details = aiResponse.details || {};

    // Get primary pet to link
    let targetPet = pets.length > 0 ? pets[0] : null;
    if (details.pet_name && pets.length > 0) {
      const match = pets.find(p => p.name.toLowerCase() === details.pet_name.toLowerCase());
      if (match) targetPet = match;
    }

    // Create pet if booking requested but client has no pets
    if (!targetPet && (aiResponse.intent === 'book_appointment' || details.pet_name)) {
      const petName = details.pet_name || 'Mascota';
      targetPet = await petService.createPet({
        name: petName,
        species: 'dog', // Default to dog
        clientId: client.id,
        clinicId: clinicId
      });
      // Refresh pets list
      pets.push(targetPet);
    }

    if (aiResponse.intent === 'book_appointment') {
      if (details.date && details.time && targetPet) {
        const isDup = await appointmentService.hasDuplicateAppointment(targetPet.id, details.date, details.time, clinicId);
        if (isDup) {
          finalResponseText = `Ya tienes una cita programada para esa fecha y hora 😊 ¿Deseas cambiarla o agendar en otro horario?`;
        } else {
          const appt = await appointmentService.createAppointment({
            petId: targetPet.id,
            date: details.date,
            time: details.time,
            notes: details.reason || messageText,
            clinicId: clinicId
          });
          finalResponseText = `📅 Cita registrada correctamente para ${targetPet.name} 😊\n\n📆 Fecha: ${details.date}\n🕒 Hora: ${details.time}`;
          if (socketEmitter) {
            socketEmitter('appointment_confirmed', { clinicId, appointment: appt, petName: targetPet.name, clientName: client.name });
          }
        }
      }
    } else if (aiResponse.intent === 'cancel_appointment') {
      if (targetPet) {
        const cancelledAppt = await appointmentService.cancelLastAppointmentForPet(targetPet.id, clinicId);
        if (cancelledAppt) {
          finalResponseText = `Entendido. Cita cancelada correctamente para ${targetPet.name} 🐾.`;
          if (socketEmitter) {
            socketEmitter('appointment_cancelled', { clinicId, appointmentId: cancelledAppt.id });
          }
        } else {
          finalResponseText = `No encontré ninguna cita programada activa para ${targetPet.name} que se pueda cancelar.`;
        }
      }
    } else if (aiResponse.intent === 'reschedule_appointment') {
      if (details.date && details.time && targetPet) {
        const rescheduled = await appointmentService.rescheduleLastAppointmentForPet(targetPet.id, details.date, details.time, clinicId);
        if (rescheduled) {
          finalResponseText = `La cita de ${targetPet.name} ha sido reprogramada con éxito para la nueva fecha: ${details.date} a las ${details.time} 📅.`;
          if (socketEmitter) {
            socketEmitter('appointment_confirmed', { clinicId, appointment: rescheduled, petName: targetPet.name, clientName: client.name });
          }
        } else {
          // If no previous appointment found, create a new one instead
          const appt = await appointmentService.createAppointment({
            petId: targetPet.id,
            date: details.date,
            time: details.time,
            notes: details.reason || messageText,
            clinicId: clinicId
          });
          finalResponseText = `No encontramos una cita anterior para reprogramar, pero te he reservado una nueva cita para ${targetPet.name} 📅\n\n📆 Fecha: ${details.date}\n🕒 Hora: ${details.time}`;
          if (socketEmitter) {
            socketEmitter('appointment_confirmed', { clinicId, appointment: appt, petName: targetPet.name, clientName: client.name });
          }
        }
      }
    } else if (aiResponse.intent === 'confirm_appointment') {
      // Check confirmation reply (e.g. Yes/Si)
      if (targetPet) {
        const confirmed = await appointmentService.confirmLastAppointmentForPet(targetPet.id, clinicId);
        if (confirmed) {
          finalResponseText = `¡Excelente! Cita confirmada correctamente para ${targetPet.name} 🐾. Te esperamos.`;
          if (socketEmitter) {
            socketEmitter('appointment_confirmed', { clinicId, appointment: confirmed, petName: targetPet.name, clientName: client.name });
          }
        }
      }
    }

    // 7. Save AI Message to Database
    await sql`
      INSERT INTO messages (clinic_id, phone, message, role, status)
      VALUES (${clinicId}, ${phone}, ${finalResponseText}, 'assistant', 'sent')
    `;
    if (socketEmitter) {
      socketEmitter('new_message', {
        clinicId,
        phone,
        message: finalResponseText,
        role: 'assistant',
        status: 'sent',
        createdAt: new Date().toISOString()
      });
    }


    return finalResponseText;
  } catch (err) {
    console.error('Error in orchestrator processMessage:', err);
    return 'Lo siento, tuve un problema interno al procesar tu solicitud 😟. ¿Podrías intentar escribir tu mensaje nuevamente?';
  }
}
