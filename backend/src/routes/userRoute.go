package routes

import (
	"myModule/src/controllers"

	"github.com/gorilla/mux"
)

func UserRouter(r *mux.Router) {

	r.HandleFunc("/fetchusers", controllers.FetchUsers).Methods("POST")
	r.HandleFunc("/fetchuser", controllers.FetchUser).Methods("POST")
	r.HandleFunc("/updatealluserinfo", controllers.UpdateAllUserInfo).Methods("POST")
	r.HandleFunc("/revertuserpassword", controllers.RevertUserPassword).Methods("POST")
	r.HandleFunc("/updatealluserinfoep", controllers.UpdateAllUserInfoEP).Methods("POST")
	r.HandleFunc("/updateuseremail", controllers.UpdateUserEmail).Methods("POST")

	r.HandleFunc("/updateuserpassword", controllers.UpdateUserPassword).Methods("POST")
	//GIN
	r.HandleFunc("/authenticate", controllers.Authenticate).Methods("POST")
	r.HandleFunc("/authorize", controllers.Authorize).Methods("POST")
	r.HandleFunc("/createUser", controllers.CreateUser).Methods("POST")

}
