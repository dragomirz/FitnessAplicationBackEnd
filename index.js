const { MongoClient } = require("mongodb");
const crypto = require("crypto");
const express = require("express");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const url = "mongodb://0.0.0.0:27017";
const client = new MongoClient(url);
client.connect().then(() => console.log("Connected to MongoDB!")); // Това съобщение е само за конзолата на сървъра
const db = client.db("main");

const getRandomString = (len) => crypto.randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);
const sha512 = (password, salt) => {
    const hash = crypto.createHmac("sha512", salt);
    hash.update(password);
    return { salt, passwordHash: hash.digest("hex") };
};
const saltHashPassword = (password) => {
    const salt = getRandomString(16);
    return sha512(password, salt);
};
const checkHashPassword = (password, salt) => sha512(password, salt);

const authenticateToken = (req, res, next) => {
    const token = req.headers["authorization"]?.split(" ")[1];
    // Съобщенията за грешки 401 и 403 се изпращат стандартно от Express/Node, няма нужда от превод тук
    if (!token) return res.sendStatus(401);
    jwt.verify(token, process.env.TOKEN_SECRET || "your-secret-key", (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

app.post("/register", async (req, res) => {
    try {
        const { email, password, name, height, gender, weight, age } = req.body;
        // Превод на съобщението за грешка
        if (!password) return res.status(400).json({ error: "Паролата е задължителна" });
        let calories;

        // Сравнението с "Male" и "Female" ОСТАВА НЕПРЕВЕДЕНО, както поискахте
        if(gender == "Male"){
            calories = (10 * weight) + (6.25 * height) - (5 * age) + 5;
        } else if(gender == "Female") {
            calories = (10 * weight) + (6.25 * height) - (5 * age) - 161;
        } else {
            calories = (10 * weight) + (6.25 * height) - (5 * age) - 76;
        }

        const { salt, passwordHash } = saltHashPassword(password);
        const userData = { email, password: passwordHash, name, salt, height, gender, weight, age, calories };

        const userCount = await db.collection("user").countDocuments({ email });
        if (userCount > 0) {
            // Превод на съобщението
            res.json({ message: "Имейлът вече съществува" });
        } else {
            await db.collection("user").insertOne(userData);
            // Превод на съобщението
            res.json({ message: "Регистрацията успешна!" });
        }
    } catch (err) {
        console.error(err);
        // Превод на съобщението за грешка
        res.status(500).json({ error: "Сървърна грешка" });
    }
});

app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await db.collection("user").findOne({ email });
        // Превод на съобщението
        if (!user) return res.json({ message: "Имейлът не съществува" });

        const { passwordHash } = checkHashPassword(password, user.salt);
        if (passwordHash === user.password) {
            const token = jwt.sign({ email }, process.env.TOKEN_SECRET || "your-secret-key", { expiresIn: "1800s" });
            // Превод на съобщението
            res.json({ message: "Входът успешен!", token });
        } else {
            // Превод на съобщението
            res.json({ message: "Грешна парола!" });
        }
    } catch (err) {
        console.error(err);
        // Превод на съобщението за грешка
        res.status(500).json({ error: "Сървърна грешка" });
    }
});

app.get("/get-user-data", authenticateToken, async (req, res) => {
    const { email } = req.user;
    // Този ендпойнт връща директно данни, няма текстови съобщения за превод
    const user = await db.collection("user").findOne({ email });
    res.json(user);
});

app.post("/log-food", authenticateToken, async (req, res) => {
    try {
        const { product_name, quantity, calories, proteins, carbs, fats, saturated_fat, sugars } = req.body;
        const user_id = req.user.email;
        const date = new Date().toISOString().split("T")[0];
        const logEntry = { user_id, date, product_name, quantity, calories, proteins, carbs, fats, saturated_fat, sugars };
        await db.collection("food_logs").insertOne(logEntry);
        // Превод на съобщението
        res.json({ message: "Храната е записана успешно!" });
    } catch (err) {
        console.error(err);
        // Превод на съобщението за грешка
        res.status(500).json({ error: "Сървърна грешка" });
    }
});

app.get("/daily-logs", authenticateToken, async (req, res) => {
    try {
        const { date, range } = req.query;
        const user_id = req.user.email;
        let startDate, endDate;

        console.log(`Raw query params - date: ${date}, range: ${range}`);

        const queryDate = date ? new Date(`${date}T00:00:00Z`) : new Date();
        queryDate.setUTCHours(0, 0, 0, 0);

        let query = { user_id };
        let responsePayload = {};

        if (range === "weekly") {
            endDate = new Date(queryDate);
            endDate.setUTCHours(23, 59, 59, 999);

            startDate = new Date(queryDate);
            startDate.setUTCDate(queryDate.getUTCDate() - 6);
            startDate.setUTCHours(0, 0, 0, 0);

            const startDateStr = startDate.toISOString().split("T")[0];
            const endDateStr = endDate.toISOString().split("T")[0];

            console.log(`Querying weekly logs for user: ${user_id}, date range: ${startDateStr} to ${endDateStr}`);

            query.date = {
                $gte: startDateStr,
                $lte: endDateStr
            };

            const logs = await db.collection("food_logs").find(query).sort({ date: 1 }).toArray();
            console.log(`Found ${logs.length} logs for weekly breakdown.`);

            const dailyTotalsMap = new Map();

            for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
                const dateString = d.toISOString().split("T")[0];
                dailyTotalsMap.set(dateString, { date: dateString, totals: { calories: 0, proteins: 0, carbs: 0, fats: 0, saturated_fat: 0, sugars: 0 } });
            }

            logs.forEach(log => {
                const dayData = dailyTotalsMap.get(log.date);
                if (dayData) {
                    dayData.totals.calories += log.calories || 0;
                    dayData.totals.proteins += log.proteins || 0;
                    dayData.totals.carbs += log.carbs || 0;
                    dayData.totals.fats += log.fats || 0;
                    dayData.totals.saturated_fat += log.saturated_fat || 0;
                    dayData.totals.sugars += log.sugars || 0;
                }
            });

            responsePayload.dailyData = Array.from(dailyTotalsMap.values());

        } else {
            switch (range) {
                case "monthly":
                    startDate = new Date(queryDate);
                    startDate.setUTCDate(1);
                    startDate.setUTCHours(0, 0, 0, 0);

                    endDate = new Date(queryDate);
                    endDate.setUTCMonth(queryDate.getUTCMonth() + 1);
                    endDate.setUTCDate(0);
                    endDate.setUTCHours(23, 59, 59, 999);
                    break;
                case "daily":
                default:
                    startDate = new Date(queryDate);
                    endDate = new Date(queryDate);
                    endDate.setUTCHours(23, 59, 59, 999);
                    break;
            }

            const startDateStr = startDate.toISOString().split("T")[0];
            const endDateStr = endDate.toISOString().split("T")[0];
            console.log(`Querying aggregate logs for user: ${user_id}, range: ${range || 'daily'}, date: ${startDateStr} to ${endDateStr}`);

            query.date = {
                $gte: startDateStr,
                $lte: endDateStr
            };

            const logs = await db.collection("food_logs").find(query).toArray();
            console.log(`Found ${logs.length} logs for aggregate total.`);

            const totals = logs.reduce((acc, log) => ({
                calories: acc.calories + (log.calories || 0),
                proteins: acc.proteins + (log.proteins || 0),
                carbs: acc.carbs + (log.carbs || 0),
                fats: acc.fats + (log.fats || 0),
                saturated_fat: acc.saturated_fat + (log.saturated_fat || 0),
                sugars: acc.sugars + (log.sugars || 0)
            }), { calories: 0, proteins: 0, carbs: 0, fats: 0, saturated_fat: 0, sugars: 0 });

            responsePayload.totals = totals;
        }

        res.json(responsePayload); // Този ендпойнт връща данни, няма нужда от превод тук

    } catch (err) {
        console.error("Error fetching daily logs:", err);
        // Превод на съобщението за грешка
        res.status(500).json({ error: "Сървърна грешка при извличане на записи" });
    }
});

app.get("/logs-by-date", authenticateToken, async (req, res) => {
    try {
        const { date } = req.query;
        const user_id = req.user.email;

        if (!date) {
            // Превод на съобщението за грешка
            return res.status(400).json({ error: "Параметърът за дата е задължителен" });
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            // Превод на съобщението за грешка
            return res.status(400).json({ error: "Невалиден формат на датата. Използвайте ГГГГ-ММ-ДД." });
        }

        console.log(`Querying individual logs for user: ${user_id}, date: ${date}`);

        const logs = await db.collection("food_logs")
            .find({
                user_id: user_id,
                date: date
            })
            .sort({ _id: -1 })
            .toArray();

        console.log(`Found ${logs.length} individual logs for ${date}`);

        res.json(logs); // Този ендпойнт връща данни, няма нужда от превод тук

    } catch (err) {
        console.error("Error fetching logs by date:", err);
        // Превод на съобщението за грешка
        res.status(500).json({ error: "Сървърна грешка при извличане на записи" });
    }
});


app.listen(3000, () => console.log("Server is listening on port 3000")); // Това съобщение е само за конзолата на сървъра
// ... (съществуващия код) ...

// --- НОВ ЕНДПОЙНТ ЗА АКТУАЛИЗАЦИЯ НА ДАННИ ---
app.put("/update-user-data", authenticateToken, async (req, res) => {
    const { email } = req.user; // Вземаме имейла от валидирания токен
    const updateData = req.body; // Очакваме обект с полетата за актуализация

    // Списък с полета, които потребителят МОЖЕ да актуализира през този ендпойнт
    const allowedUpdates = ['name', 'height', 'weight', 'age', 'calorie_goal']; // Име, Височина, Тегло, Възраст, Кал. цел
    const finalUpdate = {};
    let needsCalorieRecalculation = false;

    // Филтрираме само позволените полета от заявката
    for (const key in updateData) {
        if (allowedUpdates.includes(key) && updateData[key] !== undefined && updateData[key] !== null) {
            // Преобразуваме към правилния тип, ако е нужно (особено за числа)
            if (['height', 'weight', 'calorie_goal'].includes(key)) {
                 // Проверка за валидно число преди конвертиране
                 const numValue = parseFloat(updateData[key]);
                 if (!isNaN(numValue)) {
                    finalUpdate[key] = numValue;
                     if (['height', 'weight'].includes(key)) needsCalorieRecalculation = true; // Маркираме, ако тегло/височина се променят
                 } else {
                      // Изпращаме грешка, ако числото е невалидно
                      return res.status(400).json({ error: `Невалидна стойност за ${key}` });
                 }
            } else if (key === 'age') {
                 const intValue = parseInt(updateData[key], 10);
                 if (!isNaN(intValue)) {
                     finalUpdate[key] = intValue;
                     needsCalorieRecalculation = true; // Маркираме, ако възраст се променя
                 } else {
                    return res.status(400).json({ error: `Невалидна стойност за ${key}` });
                 }
            } else {
                // За други полета (като name, въпреки че не го правим редактируемо в UI)
                finalUpdate[key] = updateData[key];
            }
        }
    }

    // Ако няма валидни данни за актуализация, връщаме съобщение
    if (Object.keys(finalUpdate).length === 0) {
        return res.status(400).json({ message: "Няма данни за актуализация" });
    }

    try {
        // Ако трябва да преизчислим калориите (тегло, височина, възраст се променят)
        if (needsCalorieRecalculation) {
             // Трябва да вземем останалите нужни данни (пол) от базата данни
             const currentUserData = await db.collection("user").findOne({ email });
             if (!currentUserData) {
                 return res.status(404).json({ error: "Потребителят не е намерен за преизчисляване на калории" });
             }

             // Вземаме новите стойности от finalUpdate или старите, ако не се променят
             const weight = finalUpdate.weight !== undefined ? finalUpdate.weight : currentUserData.weight;
             const height = finalUpdate.height !== undefined ? finalUpdate.height : currentUserData.height;
             const age = finalUpdate.age !== undefined ? finalUpdate.age : currentUserData.age;
             const gender = currentUserData.gender; // Полът не се променя през този ендпойнт

             let calculatedCalories;
             // Използваме СЪЩАТА формула като при регистрация
             if (gender === "Male") {
                 calculatedCalories = (10 * weight) + (6.25 * height) - (5 * age) + 5;
             } else if (gender === "Female") {
                 calculatedCalories = (10 * weight) + (6.25 * height) - (5 * age) - 161;
             } else { // Fallback, ако има други стойности за gender
                 calculatedCalories = (10 * weight) + (6.25 * height) - (5 * age) - 76;
             }
             // Добавяме преизчислените калории към обекта за актуализация
             finalUpdate.calories = Math.round(calculatedCalories); // Закръгляме до цяло число
        } else if (finalUpdate.calorie_goal !== undefined) {
             
             delete finalUpdate.calorie_goal; // Не актуализираме 'calories' с ръчно зададената цел
              if (Object.keys(finalUpdate).length === 0) { // Проверка дали е останало нещо за актуализация
                 return res.status(400).json({ message: "Няма данни за актуализация (само калорийна цел, която не се пази на сървъра)" });
             }
        }


        const result = await db.collection("user").updateOne(
            { email: email },
            { $set: finalUpdate }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: "Потребителят не е намерен" });
        }

        if (result.modifiedCount === 0 && result.matchedCount === 1) {
             return res.json({ message: "Няма промени за запазване" });
        }

        // Връщаме и актуализираните данни (включително преизчислените калории, ако има)
        res.json({ message: "Данните са актуализирани успешно!", updatedFields: finalUpdate });

    } catch (err) {
        console.error("Error updating user data:", err);
        res.status(500).json({ error: "Сървърна грешка при актуализация на данни" });
    }
});
// ---------------------------------------------


// ... (останалите ендпойнти и app.listen) ...