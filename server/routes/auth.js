import express from 'express';

import config from '../config.js';

import { generateAccessToken } from '../helpers/generateAccessToken.js';

const { cypherQuerySession, mySqlDriver, REACT_FRONT_END_URL } = config;

const router = express.Router();

import jwt from 'jsonwebtoken';
import bycrypt from 'bcrypt';
import nodemailer from 'nodemailer';
import {
  authenticateUserMiddleware,
  auditTrailMiddleware
} from '../middleware/authMiddleware.js';

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    // Query the user by email and join with roles table
    const [user] = await mySqlDriver.execute(
      `
      SELECT u.*, r.role_name 
      FROM users u
      JOIN roles r ON u.role_id = r.role_id
      WHERE u.email = ?
      `,
      [email]
    );

    if (!user[0]) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if email is verified
    if (!user[0].is_verified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in',
        needsVerification: true
      });
    }

    // Compare hashed password
    const isPasswordValid = password === user[0].password;
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Fetch role-specific details
    let roleDetails = {};

    switch (user[0].role_name) {
      case 'admin':
        [roleDetails] = await mySqlDriver.execute(
          `SELECT * FROM admins WHERE user_id = ?`,
          [user[0].user_id]
        );
        break;
      case 'dentist':
        [roleDetails] = await mySqlDriver.execute(
          `SELECT * FROM dentists WHERE user_id = ?`,
          [user[0].user_id]
        );
        break;
      case 'secretary':
        [roleDetails] = await mySqlDriver.execute(
          `SELECT * FROM secretaries WHERE user_id = ?`,
          [user[0].user_id]
        );
        break;
      case 'patient':
        [roleDetails] = await mySqlDriver.execute(
          `SELECT * FROM patients WHERE user_id = ?`,
          [user[0].user_id]
        );
        break;
    }

    // Generate JWT token with role information
    const tokenPayload = {
      user_id: user[0].user_id,
      email: user[0].email,
      role: user[0].role_name,
      role_id: user[0].role_id,
      ...roleDetails[0]
    };

    const accessToken = generateAccessToken(tokenPayload);

    // Send response
    res.json({
      success: true,
      token: accessToken,
      data: {
        user_id: user[0].user_id,
        email: user[0].email,
        role: user[0].role_name,
        role_id: user[0].role_id,
        ...roleDetails[0]
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'An error occurred during login'
    });
  }
});

router.post('/logout', async (req, res) => {
  // Assuming the client stores the token in local storage or cookies
  // You can respond with a message instructing the client to delete the token

  let loggedInUser = req.user;

  console.log({ loggedInUser });

  // await auditTrailMiddleware({
  //   employeeId: loggedInUser.EmployeeID,
  //   action: 'Logout'
  // });
  res.json({
    success: true,
    message:
      'Logged out successfully. Please remove your access token from storage.'
  });
});

router.post('/forgetPassword', async (req, res, next) => {
  try {
    // Find the user by email
    // const user = await User.findOne({ mail: req.body.email });

    let email = req.body.email;

    var [user] = await mySqlDriver.execute(findUserByEmailQuery(email));

    console.log({ user });
    const foundUserByEmail = user.find(u => {
      return u.email === email;
    });

    // If user not found, send error message
    if (!foundUserByEmail) {
      res.status(401).json({
        success: false,
        message: 'Email is not registered in our system.'
      });
    } else {
      // Generate a unique JWT token for the user that contains the user's id
      const token = jwt.sign({ email: foundUserByEmail.email }, 'secret', {
        expiresIn: '10m'
      });

      // Send the token to the user's email
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: 'avdeasisjewelry2@gmail.com',
          pass: 'dqeq ukrn hvjg vnyx'
        }
      });

      // Email configuration
      const mailOptions = {
        from: 'avdeasisjewelry2@gmail.com',
        to: email,
        subject: 'Reset Password',
        html: `<h1>Reset Your Password</h1>
    <p>Click on the following link to reset your password:</p>
    <a href="${REACT_FRONT_END_URL}/reset-password/${token}">${REACT_FRONT_END_URL}/reset-password/${token}</a>
    <p>The link will expire in 10 minutes.</p>
    <p>If you didn't request a password reset, please ignore this email.</p>`
      };

      // Send the email
      transporter.sendMail(mailOptions, (err, info) => {
        if (err) {
          return res.status(500).send({ message: err.message });
        }
        res.status(200).send({ message: 'Email sent' });
      });
    }
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});
router.post('/reset-password/:token', async (req, res, next) => {
  try {
    // Verify the token sent by the user
    let newPassword = req.body.newPassword;
    const decodedToken = jwt.verify(req.params.token, 'secret');

    // If the token is invalid, return an error
    if (!decodedToken) {
      return res.status(401).send({ message: 'Invalid token' });
    }

    // find the user with the id from the token

    // console.log(decodedToken.email);

    console.log({ decodedToken });
    var [user] = await mySqlDriver.execute(
      findUserByEmailQuery(decodedToken.email)
    );
    const foundUserByEmail = user.find(u => {
      return u.email === decodedToken.email;
    });

    console.log({ foundUserByEmail });
    // If user not found, send error message
    if (!foundUserByEmail) {
      res.status(401).json({
        success: false,
        message: 'Email is not registered in our system.'
      });
    } else {
      var [user] = await mySqlDriver.execute(
        updatePassword(foundUserByEmail.email, newPassword)
      );

      await auditTrailMiddleware({
        employeeId: foundUserByEmail.EmployeeID,
        action: 'Reset Password'
      });

      res.status(200).send({ message: 'Password updated' });
    }

    // Hash the new password
    // const salt = await bycrypt.genSalt(10);
    // req.body.newPassword = await bycrypt.hash(req.body.newPassword, salt);

    // // Update user's password, clear reset token and expiration time
    // user.password = req.body.newPassword;
    // await user.save();

    // // Send success response
  } catch (err) {
    console.log(err);
    // Send error response if any error occurs
    res.status(500).send({ message: err.message });
  }
});

// Assuming express is already set up and mySqlDriver is configured
router.post('/appointments/create', async (req, res) => {
  const { email, dentistId, startTime, endTime, remarks } = req.body;

  try {
    // Check if the patient exists in the `patients` table using the provided email
    const [rows] = await mySqlDriver.execute(
      `SELECT patient_id FROM patients WHERE user_id = (SELECT user_id FROM users WHERE email = ?)`,
      [email]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    const patientId = rows[0].patient_id;

    console.log({ patientId });

    // Convert the ISO string to the MySQL-friendly datetime format
    const startFormatted = startTime;

    const endFormatted = endTime;

    // Now we can proceed with inserting the appointment
    const [insertResult] = await mySqlDriver.execute(
      `INSERT INTO appointments (patient_id, dentist_id, start, end, status, remarks) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [patientId, 1, startFormatted, endFormatted, 'Pending', 'For Approval']
    );

    res.json({ success: true, appointmentId: insertResult.insertId });
  } catch (error) {
    console.error('Error creating appointment:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get(
  '/appointments/all',
  // authenticateUserMiddleware,
  async (req, res) => {
    const { patientId } = req.query;
    let loggedInUser = req.user;

    try {
      // Query to get all appointments for the provided patient_id
      const [appointments] = await mySqlDriver.execute(
        `SELECT a.appointment_id, a.patient_id, a.dentist_id, a.start, a.end, a.status, a.remarks
       FROM appointments a
  
       
       `,
        []
      );

      // Return the list of appointments
      res.json({ success: true, data: appointments });
    } catch (error) {
      console.error('Error fetching appointments:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

export default router;
