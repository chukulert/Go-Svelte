package controllers

import (
	"database/sql"
	"encoding/json"
	"myModule/src/entities"
	"myModule/src/models"
	subController "myModule/src/sub"
	"net/http"
	"strings"
)

//DANIEL
func CreateApplication(w http.ResponseWriter, r *http.Request, username string, db *sql.DB, body []byte) {
		applicationModel := models.APPDB{
			Db: db,
		}

		application := entities.Applications{}

		//if rNumber is an int, it will cause err here
		err := json.Unmarshal(body, &application)
		if err != nil {
			subController.WriteJsonMsg(w, "Internal Server Error", false, 500)
			return
		}

		userModel := models.USERDB{
			Db: db,
		}

		// check if required inputs are empty
		if len(application.AppAcronym) == 0 || len(application.Rnumber) == 0 || len(application.StartDate) == 0 || len(application.EndDate) == 0 {
				subController.WriteJsonMsg(w, "Required fields can't be empty", false, 406)
				return
		}

		if (application.AppAcronym == "allapps") {
			subController.WriteJsonMsg(w, "Please use another app name", false, 406)
			return
		}
		//check if group is permitted to create app
		if !(userModel.CheckGroup(username, application.Group)) {
			subController.WriteJsonMsg(w, "User does not have permission to create application", false, 408)
			return
		}

		//create the app
		//error is for duplicates app name
		res, err := applicationModel.CreateApp(strings.TrimSpace(application.AppAcronym),application.Description, application.Rnumber, application.StartDate, application.EndDate,application.PermitCreate,application.PermitOpen,application.PermitToDo,application.PermitDoing, application.PermitDone )

		if res {
			subController.WriteJsonMsg(w, "success", res, 200)
		} else {
			subController.WriteJsonMsg(w, "Duplicate app acronym entry", res, 407)
		}
}

//DANIEL
func EditApplication(w http.ResponseWriter, r *http.Request, username string, db *sql.DB, body []byte) {
		applicationModel := models.APPDB{
			Db: db,
		}

		application := entities.Applications{}

		//if rNumber is an int, it will cause err here
		err := json.Unmarshal(body, &application)
		if err != nil {
			subController.WriteJsonMsg(w, "Internal Server Error", false, 500)
			return
		}

		userModel := models.USERDB{
			Db: db,
		}

		//check if group is permitted to create app
		if !(userModel.CheckGroup(username, application.Group)) {
			subController.WriteJsonMsg(w, "User does not have permission to create application", false, 408)
			return
		}

		//create the app
		//error is for duplicates app name
		res, err := applicationModel.EditApp(application.AppAcronym, application.PermitCreate,application.PermitOpen,application.PermitToDo,application.PermitDoing, application.PermitDone)

		if res {
			subController.WriteJsonMsg(w, "success", res, 200)
		} else {
			subController.WriteJsonMsg(w, "Internal Server Error", false, 501)
		}
}





//DANIEL
func GetAllApps(w http.ResponseWriter, r *http.Request, username string, db *sql.DB, body []byte) {
	
		application := entities.Applications{}
		err := json.Unmarshal(body, &application)
		if err != nil {
			subController.WriteJsonMsg(w, "Internal Server Error", false, 500)
			return;
		}

		applicationModel := models.APPDB{
			Db: db,
		}
			result, err3 := applicationModel.GetAllApps()
			if err3 != nil {
				subController.WriteJsonMsg(w, "Internal Server Error", false, 500)
			} else {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(result)
			}
}

