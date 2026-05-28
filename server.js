import express from "express";

const app = express();

app.use(express.json());

/*
====================================
FAKE DATABASE
====================================
*/

const clients = [

  {
    dni: "71234567",

    owner: "Carlos",

    pet: {
      name: "Firulais",
      type: "Perro",
      vaccine: "Rabia",
      nextVaccine: "2026-06-10"
    }
  }
];

/*
====================================
APPOINTMENTS
====================================
*/

import fs from "fs";

const APPOINTMENTS_FILE =
"./appointments.json";

function loadAppointments() {

  try {

    if (
      fs.existsSync(
        APPOINTMENTS_FILE
      )
    ) {

      const data =
        fs.readFileSync(
          APPOINTMENTS_FILE,
          "utf-8"
        );

      return JSON.parse(data);
    }

  } catch (err) {

    console.log(err);
  }

  return [];
}

function saveAppointments(
  appointments
) {

  fs.writeFileSync(
    APPOINTMENTS_FILE,
    JSON.stringify(
      appointments,
      null,
      2
    )
  );
}

const appointments =
  loadAppointments();

/*
====================================
GET CLIENT
====================================
*/

app.get("/client/:dni", (req, res) => {

  const { dni } = req.params;

  const client = clients.find(
    c => c.dni === dni
  );

  if (!client) {

    return res.status(404).json({

      success: false,

      message:
        "Cliente no encontrado"
    });
  }

  res.json({

    success: true,

    data: client
  });
});

/*
====================================
CREATE APPOINTMENT
====================================
*/

app.post("/appointment", (req, res) => {

  const {

    owner,

    pet,

    date,

    time,

    reason

  } = req.body;

  const appointment = {

    id:
      appointments.length + 1,

    owner,

    pet,

    date,

    time,

    reason
  };

  appointments.push(
    appointment
  );

  saveAppointments(
  appointments
);

  console.log(
    "📅 Nueva cita:",
    appointment
  );

  res.json({

    success: true,

    message:
      "Cita registrada",

    data:
      appointment
  });
});

/*
====================================
GET APPOINTMENTS
====================================
*/

app.get("/appointments", (req, res) => {

  res.json({

    success: true,

    total:
      appointments.length,

    data:
      appointments
  });
});

/*
====================================
SERVER
====================================
*/

app.listen(3000, () => {

  console.log(
    "🚀 VetControl API running on port 3000"
  );
});